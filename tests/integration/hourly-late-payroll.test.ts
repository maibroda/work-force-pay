import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { num } from "@/lib/money";
import { payableSegments } from "@/lib/payroll/time-entry";
import { DEFAULT_EARNINGS } from "@/lib/payroll/structure";
import { createEmployee } from "@/server/services/employees";
import { createPeriod, createSupplementaryRun, openCriticalCount, runPayroll } from "@/server/services/payroll";
import { createStructure } from "@/server/services/structures";
import { ctxFor, uid } from "../helpers";

/**
 * Hourly pay, phase 4c (docs/plans/hourly-payroll-phase4-plan.md), the founder's H22 and his answers of 2026-11-20: hours approved AFTER a payroll was locked are paid by a supplementary payroll, and only once;
 * a correction made after the lock pays only what is still owed (the increase); a correction that means the person was overpaid pays nothing and raises a BLOCKING finding for a manual deduction (no negative
 * pay). Real payrolls in the demo company, one far-future month per test (2038, which no other test uses) so the tests do not meet each other's hours; the hourly facts are put in directly (an approved shift is
 * a TimeEntry with its paid pieces), and the period is set to locked (the run is left calculated, because the ledger check wants a journal for every locked run). Rates are INVENTED: role weekday 1,000 an hour.
 * Calendar: 2038-01-04 is a Monday.
 */
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const wat = (s: string) => new Date(`${s}:00+01:00`);
const near = (actual: number, expected: number) => expect(Math.abs(actual - expected)).toBeLessThan(0.06);

async function world(tag = uid()) {
  const hr = await ctxFor("HR_ADMIN");
  const payroll = await ctxFor("PAYROLL_ADMIN");
  const org = payroll.orgId;
  const cat = await db.employeeCategory.findFirstOrThrow({ where: { organizationId: org, code: "GUARD" } });
  const structure = await createStructure(payroll, {
    code: `HL-${tag}`, name: `Hourly late ${tag}`, effectiveFrom: "2036-01-01", activate: true,
    components: DEFAULT_EARNINGS.map((c, i) => ({ code: c.code, name: c.name, calcType: "PERCENTAGE" as const, percentage: [10, 14, 15, 5, 15, 20, 2.5, 5, 13.5][i], taxable: true, pensionable: c.pensionable })),
  });
  const client = await db.client.create({ data: { organizationId: org, code: `LC${tag}`, name: `Late Client ${tag}` } });
  const contract = await db.contract.create({ data: { organizationId: org, clientId: client.id, contractNumber: `LK${tag}`, name: `Late guarding ${tag}`, startDate: day("2036-01-01") } });
  const beat = await db.beat.create({ data: { organizationId: org, clientId: client.id, contractId: contract.id, code: `LB${tag}`, name: `Late site ${tag}`, state: "Lagos" } });
  await db.contractRate.create({ data: { organizationId: org, contractId: contract.id, categoryId: cat.id, salaryStructureId: structure.id, agreedRate: "200000", effectiveFrom: day("2036-01-01") } });
  // the demo company is shared by the tests of this file: the role's hourly rate is made once
  if (!(await db.hourlyRate.findFirst({ where: { organizationId: org, scope: "CATEGORY", categoryId: cat.id, status: "APPROVED", effectiveTo: null } })))
    await db.hourlyRate.create({ data: { organizationId: org, scope: "CATEGORY", categoryId: cat.id, weekdayRate: "1000", weekendRate: "1500", holidayRate: "2000", effectiveFrom: day("2036-01-01"), reason: "test", status: "APPROVED", proposedBy: "t", proposedByUserId: "t", decidedBy: "t2", decidedByUserId: "t2" } });
  let n = 0;
  const person = async (label: string, categoryId = cat.id) => {
    n += 1;
    const e = await createEmployee(hr, { firstName: "Hl", lastName: `${label}${tag}`, employmentDate: "2036-01-01", categoryId, bankName: "GTBank", accountNumber: `78${String(Date.now()).slice(-7)}${n}`, accountName: `HL ${label}` } as never);
    await db.employeeCompensationType.create({ data: { organizationId: org, employeeId: e.id, type: "HOURLY", effectiveFrom: day("2036-01-01"), reason: "test", status: "APPROVED", proposedBy: "t", proposedByUserId: "t", decidedBy: "t", decidedByUserId: "t2" } });
    return e;
  };
  /** An APPROVED shift with its paid pieces; `corrects` makes it the correction of an earlier one, which becomes SUPERSEDED as the approval step leaves it. */
  const shift = async (employeeId: string, from: string, to: string, corrects?: string) => {
    const cin = wat(from);
    const cout = wat(to);
    const segs = payableSegments(cin, cout, [], new Set());
    const minutes = (cout.getTime() - cin.getTime()) / 60000;
    const e = await db.timeEntry.create({
      data: { organizationId: org, employeeId, clientId: client.id, contractId: contract.id, beatId: beat.id, clockIn: cin, clockOut: cout, status: "APPROVED", capturedBy: "cap", capturedByUserId: "cap-user", decidedBy: "dec", decidedByUserId: "dec-user", decidedAt: new Date(), placeState: "Lagos", calendarConfirmed: true, payableMinutes: minutes, ...(corrects ? { correctsId: corrects, reason: "test" } : {}) },
    });
    await db.timeEntrySegment.createMany({ data: segs.map((s) => ({ organizationId: org, entryId: e.id, date: day(s.date), dayClass: s.dayClass, minutes: s.minutes })) });
    if (corrects) await db.timeEntry.update({ where: { id: corrects }, data: { status: "SUPERSEDED" } });
    return e;
  };
  /** Calculates the regular payroll of a month and locks the PERIOD (all a supplementary payroll needs). The run itself is left calculated, not LOCKED: the ledger check requires a journal for every locked run, and these test runs have none. */
  const lockedMonth = async (month: number) => {
    const period = await createPeriod(payroll, 2038, month);
    const run = await runPayroll(payroll, period.id);
    await db.payrollPeriod.update({ where: { id: period.id }, data: { status: "LOCKED" } });
    return { period, run };
  };
  const record = (runId: string, employeeId: string) => db.payrollRecord.findFirstOrThrow({ where: { runId, employeeId } });
  const pieces = (runId: string, employeeId: string, kind: "PAID" | "CREDITED") => db.hourlyPayPiece.findMany({ where: { runId, employeeId, kind } });
  return { payroll, org, cat, person, shift, lockedMonth, record, pieces, tag, structure };
}

describe("a regular payroll records which approved pieces it paid", () => {
  it("every piece of every approved shift it paid is marked as paid on the person's record, and calculating again replaces the marks instead of adding to them", async () => {
    const w = await world();
    const e = await w.person("Mark");
    const a = await w.shift(e.id, "2038-06-07T08:00", "2038-06-07T16:00");
    const period = await createPeriod(w.payroll, 2038, 6);
    const first = await runPayroll(w.payroll, period.id);
    const rec = await w.record(first.id, e.id);
    const segs = await db.timeEntrySegment.findMany({ where: { entryId: a.id } });
    const marks = await w.pieces(first.id, e.id, "PAID");
    expect(marks.map((m) => m.segmentId).sort()).toEqual(segs.map((s) => s.id).sort());
    expect(marks.every((m) => m.recordId === rec.id && m.organizationId === w.org)).toBe(true);
    const second = await runPayroll(w.payroll, period.id);
    expect(second.id).toBe(first.id);
    expect(await w.pieces(second.id, e.id, "PAID")).toHaveLength(segs.length);
  });
});

describe("a shift approved after the payroll was locked is paid by a supplementary payroll, once (H22)", () => {
  it("pays the late shift only, leaves the locked payroll as it was, and a second supplementary payroll does not pay it again", async () => {
    const w = await world();
    const e = await w.person("Late");
    await w.shift(e.id, "2038-01-04T08:00", "2038-01-04T16:00"); // paid by the regular payroll: 8,000
    const { period, run } = await w.lockedMonth(1);
    near(num((await w.record(run.id, e.id)).earnedGross), 8_000);
    const late = await w.shift(e.id, "2038-01-05T08:00", "2038-01-05T14:00"); // approved after the lock: 6 h = 6,000
    const supp = await createSupplementaryRun(w.payroll, period.id, "Late hours");
    const rec = await w.record(supp.id, e.id);
    near(num(rec.earnedGross), 6_000);
    near(num(rec.totalEarnings), 6_000);
    expect(num(rec.monthlyGross)).toBe(0);
    near(num(rec.netPay), num(rec.totalEarnings) - num(rec.employeePension) - num(rec.paye));
    const lines = await db.hourlyPayLine.findMany({ where: { recordId: rec.id } });
    expect(lines.map((l) => [l.dayClass, l.minutes, num(l.amount)])).toEqual([["WEEKDAY", 360, 6000]]);
    expect(lines[0].entryIds).toEqual([late.id]);
    const lateSegs = await db.timeEntrySegment.findMany({ where: { entryId: late.id } });
    expect((await w.pieces(supp.id, e.id, "PAID")).map((m) => m.segmentId).sort()).toEqual(lateSegs.map((s) => s.id).sort());
    // the locked payroll is untouched
    near(num((await w.record(run.id, e.id)).earnedGross), 8_000);
    // and what was paid is not paid again
    await expect(createSupplementaryRun(w.payroll, period.id, "Again")).rejects.toThrow(/no approved, unprocessed/i);
  });

  it("PAYE on the late hours is only the extra tax over what the locked payroll already taxed: more than nothing, and never more than the top rate on the late hours", async () => {
    const w = await world();
    const e = await w.person("Tax");
    const weekdays = ["05", "06", "07", "08", "09", "12", "13", "14", "15", "16", "19", "20", "21", "22", "23", "26", "27", "28", "29", "30"];
    for (const d of weekdays) await w.shift(e.id, `2038-07-${d}T08:00`, `2038-07-${d}T20:00`); // 20 shifts of 12 h = 240,000 in the locked payroll
    const { period, run } = await w.lockedMonth(7);
    const locked = await w.record(run.id, e.id);
    near(num(locked.earnedGross), 240_000);
    expect(num(locked.paye)).toBeGreaterThan(0);
    await w.shift(e.id, "2038-07-10T08:00", "2038-07-10T20:00"); // a Saturday, 12 h at the weekend rate = 18,000, approved after the lock
    const supp = await createSupplementaryRun(w.payroll, period.id, "Late hours");
    const rec = await w.record(supp.id, e.id);
    near(num(rec.earnedGross), 18_000);
    expect(num(rec.paye)).toBeGreaterThan(0);
    expect(num(rec.paye)).toBeLessThanOrEqual(18_000 * 0.25); // the tax on top of the locked payroll's: at most the top band's rate on the extra pay (never the tax on the late hours alone from zero)
    near(num(rec.netPay), num(rec.totalEarnings) - num(rec.employeePension) - num(rec.paye));
  });
});

describe("a correction made after the lock (H22, the founder's answers of 2026-11-20)", () => {
  it("that makes the person owed more pays only the difference", async () => {
    const w = await world();
    const e = await w.person("Up");
    const a = await w.shift(e.id, "2038-02-02T08:00", "2038-02-02T16:00"); // 8 h paid: 8,000
    const { period, run } = await w.lockedMonth(2);
    near(num((await w.record(run.id, e.id)).earnedGross), 8_000);
    const fix = await w.shift(e.id, "2038-02-02T08:00", "2038-02-02T17:00", a.id); // now 9 h: 1 h more is owed
    const supp = await createSupplementaryRun(w.payroll, period.id, "Correction");
    near(num((await w.record(supp.id, e.id)).earnedGross), 1_000);
    const credited = await w.pieces(supp.id, e.id, "CREDITED");
    const oldSegs = await db.timeEntrySegment.findMany({ where: { entryId: a.id } });
    expect(credited.map((m) => m.segmentId).sort()).toEqual(oldSegs.map((s) => s.id).sort());
    const newSegs = await db.timeEntrySegment.findMany({ where: { entryId: fix.id } });
    expect((await w.pieces(supp.id, e.id, "PAID")).map((m) => m.segmentId).sort()).toEqual(newSegs.map((s) => s.id).sort());
    await expect(createSupplementaryRun(w.payroll, period.id, "Again")).rejects.toThrow(/no approved, unprocessed/i);
  });

  it("that makes the person overpaid pays nothing (never negative pay) and raises a blocking finding that names the hours, for a manual deduction", async () => {
    const w = await world();
    const e = await w.person("Down");
    const a = await w.shift(e.id, "2038-03-02T08:00", "2038-03-02T16:00"); // 8 h paid
    const { period, run } = await w.lockedMonth(3);
    await w.shift(e.id, "2038-03-02T08:00", "2038-03-02T14:00", a.id); // now 6 h: 2 h were overpaid
    const supp = await createSupplementaryRun(w.payroll, period.id, "Correction");
    expect(await db.payrollRecord.count({ where: { runId: supp.id, employeeId: e.id } })).toBe(0); // nothing to pay, so no negative pay
    const found = await db.payrollValidationIssue.findMany({ where: { runId: supp.id, employeeId: e.id, code: "HOURLY_PAY_DECREASED" } });
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("CRITICAL");
    expect(found[0].message).toMatch(/2 h/);
    expect(found[0].message).toContain("2,000.00"); // 2 h at the weekday rate of 1,000, the rate in force that day
    expect(found[0].message).toMatch(/deduction/i);
    expect(await openCriticalCount(supp.id)).toBeGreaterThan(0);
    near(num((await w.record(run.id, e.id)).earnedGross), 8_000); // the locked payroll is untouched
    // it is flagged once: the pieces are settled, so the next supplementary payroll does not flag or pay it again
    await expect(createSupplementaryRun(w.payroll, period.id, "Again")).rejects.toThrow(/no approved, unprocessed/i);
  });
});

describe("NHF on late hourly pay (the founder's answer of 2026-11-20)", () => {
  it("takes the NHF of a person who chose it from the late pay as its own deduction line, 2.5% of the Basic part, and none from a person who did not", async () => {
    const w = await world();
    const chose = await w.person("Chose");
    const notChose = await w.person("NotChose");
    await db.employee.update({ where: { id: chose.id }, data: { nhfContributes: true, nhfOptedInOn: day("2038-01-01") } });
    const { period } = await w.lockedMonth(8);
    for (const p of [chose, notChose]) await w.shift(p.id, "2038-08-02T08:00", "2038-08-02T20:00"); // approved after the lock: 12 h = 12,000 each
    const supp = await createSupplementaryRun(w.payroll, period.id, "Late hours");
    const a = await w.record(supp.id, chose.id);
    const lines = a.lines as Array<{ type: string; code: string; amount: number }>;
    const nhf = lines.find((l) => l.code === "NHF");
    const basic = lines.find((l) => l.code === "BASIC")!;
    expect(nhf).toBeDefined();
    expect(nhf!.type).toBe("DEDUCTION");
    near(nhf!.amount, basic.amount * 0.025);
    expect(nhf!.amount).toBeGreaterThan(0);
    near(num(a.netPay), num(a.totalEarnings) - num(a.employeePension) - num(a.paye) - nhf!.amount);
    const b = await w.record(supp.id, notChose.id);
    expect((b.lines as Array<{ code: string }>).some((l) => l.code === "NHF")).toBe(false);
    near(num(b.netPay), num(b.totalEarnings) - num(b.employeePension) - num(b.paye));
  });
});

describe("a payroll locked before pieces were recorded (older data) is not paid twice", () => {
  it("shifts that an earlier payroll's pay lines name count as paid even with no pieces recorded", async () => {
    const w = await world();
    const e = await w.person("Old");
    await w.shift(e.id, "2038-04-05T08:00", "2038-04-05T16:00");
    const { period, run } = await w.lockedMonth(4);
    await db.hourlyPayPiece.deleteMany({ where: { runId: run.id } }); // as if the payroll had been calculated before pieces were recorded
    await expect(createSupplementaryRun(w.payroll, period.id, "Nothing new")).rejects.toThrow(/no approved, unprocessed/i);
    // and a real late shift is still paid, alone
    await w.shift(e.id, "2038-04-06T08:00", "2038-04-06T12:00");
    const supp = await createSupplementaryRun(w.payroll, period.id, "Late hours");
    near(num((await w.record(supp.id, e.id)).earnedGross), 4_000);
  });
});

describe("late hours that cannot be priced are not paid, and stay owed", () => {
  it("a job role with no approved hourly rate: a blocking finding names the hours and nothing is marked as paid", async () => {
    const w = await world();
    // a job role made for this test, so no other test file can ever give it an hourly rate
    const bare = await db.employeeCategory.create({ data: { organizationId: w.org, code: `NR${w.tag}`.slice(0, 12), name: `No-rate role ${w.tag}` } });
    const e = await w.person("NoRate", bare.id);
    const { period } = await w.lockedMonth(5);
    await w.shift(e.id, "2038-05-03T08:00", "2038-05-03T16:00");
    const supp = await createSupplementaryRun(w.payroll, period.id, "Late hours");
    const found = await db.payrollValidationIssue.findMany({ where: { runId: supp.id, employeeId: e.id, code: "HOURLY_NO_RATE" } });
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("CRITICAL");
    expect(await db.payrollRecord.count({ where: { runId: supp.id, employeeId: e.id } })).toBe(0);
    expect(await db.hourlyPayPiece.count({ where: { runId: supp.id, employeeId: e.id } })).toBe(0); // so a later supplementary payroll, once the rate is approved, still pays them
  });
});
