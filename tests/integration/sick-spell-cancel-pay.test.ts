import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { num } from "@/lib/money";
import { payableSegments } from "@/lib/payroll/time-entry";
import { DEFAULT_EARNINGS } from "@/lib/payroll/structure";
import { createEmployee } from "@/server/services/employees";
import { createPeriod, runPayroll } from "@/server/services/payroll";
import { cancelSickSpell } from "@/server/services/sick-leave";
import { createStructure } from "@/server/services/structures";
import { ctxFor, uid } from "../helpers";

/**
 * Hourly pay, H14: cancelling an APPROVED spell of sickness (docs/plans/hourly-sick-spell-correction-plan.md). If the days were not yet paid, the next calculation simply leaves them out. If a locked payroll already paid them,
 * NO NEGATIVE PAY is ever made (the rule the hourly pay already follows for hours corrected after payment): the next payroll raises ONE critical finding naming the person, the days and the amount from the stored sick pay line,
 * for Payroll to enter a deduction if it is to be recovered. A replacement spell for the same days is not paid twice. Real payrolls in the demo company for March, April and May 2052 (no other test uses 2052); hours and spells
 * are put in directly. Rates are INVENTED: role weekday 1,000 an hour. Calendar: 2052-01-01, 2052-03-04, 2052-04-01 and 2052-05-06 are Mondays.
 */
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const wat = (s: string) => new Date(`${s}:00+01:00`);
const near = (actual: number, expected: number) => expect(Math.abs(actual - expected)).toBeLessThan(0.06);

async function world(tag = uid()) {
  const hr = await ctxFor("HR_ADMIN");
  const payroll = await ctxFor("PAYROLL_ADMIN");
  const org = payroll.orgId;
  await db.leavePolicy.upsert({ where: { organizationId: org }, create: { organizationId: org, sickDaysPerYear: 5 }, update: { sickDaysPerYear: 5 } });
  const cat = await db.employeeCategory.findFirstOrThrow({ where: { organizationId: org, code: "GUARD" } });
  const structure = await createStructure(payroll, {
    code: `SP-${tag}`, name: `Sick pay ${tag}`, effectiveFrom: "2040-01-01", activate: true,
    components: DEFAULT_EARNINGS.map((c, i) => ({ code: c.code, name: c.name, calcType: "PERCENTAGE" as const, percentage: [10, 14, 15, 5, 15, 20, 2.5, 5, 13.5][i], taxable: true, pensionable: c.pensionable })),
  });
  const client = await db.client.create({ data: { organizationId: org, code: `SQ${tag}`, name: `Sick Client ${tag}` } });
  const contract = await db.contract.create({ data: { organizationId: org, clientId: client.id, contractNumber: `SQK${tag}`, name: `Sick guarding ${tag}`, startDate: day("2040-01-01") } });
  const beat = await db.beat.create({ data: { organizationId: org, clientId: client.id, contractId: contract.id, code: `SQB${tag}`, name: `Sick site ${tag}`, state: "Lagos" } });
  await db.contractRate.create({ data: { organizationId: org, contractId: contract.id, categoryId: cat.id, salaryStructureId: structure.id, agreedRate: "200000", effectiveFrom: day("2040-01-01") } });
  if (!(await db.hourlyRate.findFirst({ where: { organizationId: org, scope: "CATEGORY", categoryId: cat.id, status: "APPROVED", effectiveTo: null } })))
    await db.hourlyRate.create({ data: { organizationId: org, scope: "CATEGORY", categoryId: cat.id, weekdayRate: "1000", weekendRate: "1500", holidayRate: "2000", effectiveFrom: day("2030-01-01"), reason: "test", status: "APPROVED", proposedBy: "t", proposedByUserId: "t", decidedBy: "t2", decidedByUserId: "t2" } });
  let n = 0;
  const person = async (label: string, employmentDate = "2040-01-01") => {
    n += 1;
    const e = await createEmployee(hr, { firstName: "Sp", lastName: `${label}${tag}`, employmentDate, categoryId: cat.id, bankName: "GTBank", accountNumber: `72${String(Date.now()).slice(-7)}${n}`, accountName: `SP ${label}` } as never);
    await db.employeeCompensationType.create({ data: { organizationId: org, employeeId: e.id, type: "HOURLY", effectiveFrom: day(employmentDate), reason: "test", status: "APPROVED", proposedBy: "t", proposedByUserId: "t", decidedBy: "t", decidedByUserId: "t2" } });
    return e;
  };
  const shift = async (employeeId: string, from: string, to: string) => {
    const cin = wat(from);
    const cout = wat(to);
    const en = await db.timeEntry.create({ data: { organizationId: org, employeeId, clientId: client.id, contractId: contract.id, beatId: beat.id, clockIn: cin, clockOut: cout, status: "APPROVED", capturedBy: "cap", capturedByUserId: "cap-user", decidedBy: "dec", decidedByUserId: "dec-user", decidedAt: new Date(), placeState: "Lagos", calendarConfirmed: true, payableMinutes: (cout.getTime() - cin.getTime()) / 60000 } });
    await db.timeEntrySegment.createMany({ data: payableSegments(cin, cout, [], new Set()).map((s) => ({ organizationId: org, entryId: en.id, date: day(s.date), dayClass: s.dayClass, minutes: s.minutes })) });
  };
  /** Eight-hour shifts, Monday to Thursday of the week of the given Monday: the person's usual days, 32 h over 4 days worked. */
  const usualWeek = async (employeeId: string, monday: string) => {
    for (let i = 0; i < 4; i++) {
      const date = new Date(day(monday).getTime() + i * 86_400_000).toISOString().slice(0, 10);
      await shift(employeeId, `${date}T08:00`, `${date}T16:00`);
    }
  };
  /** An approved (or other) spell of sickness put in directly, with a certificate document, charged to the leave year that holds its first day (every test person has been in service since 2040). */
  const spell = async (employeeId: string, from: string, to: string, workingDays: number, status: "APPROVED" | "PENDING" = "APPROVED") => {
    const doc = await db.employeeDocument.create({ data: { organizationId: org, employeeId, documentType: "MEDICAL_CERTIFICATE", fileReference: `ref-${uid()}`, uploadedBy: "t" } });
    const year = Number(from.slice(0, 4));
    return db.sickSpell.create({ data: { organizationId: org, employeeId, cycleStart: day(`${year}-01-01`), cycleEnd: day(`${year}-12-31`), startDate: day(from), endDate: day(to), workingDays, certificateDocumentId: doc.id, status, recordedBy: "t", recordedByUserId: "t", ...(status === "APPROVED" ? { decidedBy: "t2", decidedByUserId: "t2", decidedAt: new Date() } : {}) } });
  };
  const record = (runId: string, employeeId: string) => db.payrollRecord.findFirstOrThrow({ where: { runId, employeeId } });
  const sick = (recordId: string) => db.hourlyAllowanceLine.findMany({ where: { recordId, kind: "SICK_DAY" } });
  const finding = (runId: string, employeeId: string, code: string) => db.payrollValidationIssue.findMany({ where: { runId, employeeId, code } });
  return { hr: () => ctxFor("HR_ADMIN"), payroll, org, person, shift, usualWeek, spell, record, sick, finding, beat };
}

const periodOf = async (orgId: string, ctx: Awaited<ReturnType<typeof ctxFor>>, year: number, month: number) => (await db.payrollPeriod.findFirst({ where: { organizationId: orgId, year, month } })) ?? createPeriod(ctx, year, month);

// each test has its own months, because a locked payroll month stays locked for the next test: March 2052 (not locked), April 2052 (locked, then May and June run), March 2053 (locked, then April run)
describe("a cancelled approved spell and the pay", () => {
  it("cancelled before payroll paid it (the month is not locked): the next calculation leaves the days out, with no finding", async () => {
    const w = await world();
    const e = await w.person("Early");
    await w.usualWeek(e.id, "2052-01-01"); // Monday to Thursday, 8 h
    const s = await w.spell(e.id, "2052-03-04", "2052-03-05", 2); // Monday and Tuesday
    const period = await periodOf(w.org, w.payroll, 2052, 3);
    const run = await runPayroll(w.payroll, period.id);
    near(num((await w.record(run.id, e.id)).earnedGross), 16_000);
    await cancelSickSpell(await w.hr(), s.id, "Recorded for the wrong person");
    const again = await runPayroll(w.payroll, period.id);
    expect(again.id).toBe(run.id);
    expect(await db.hourlyAllowanceLine.count({ where: { runId: run.id, employeeId: e.id, kind: "SICK_DAY" } })).toBe(0);
    expect(await w.finding(run.id, e.id, "SICK_PAY_WITHDRAWN")).toHaveLength(0);
  });

  it("already paid (the month is locked): the next payroll raises ONE critical finding with the days and the amount paid, makes no negative pay, keeps it if calculated again, and does not repeat it in a later payroll", async () => {
    const w = await world();
    const e = await w.person("Paid");
    await w.usualWeek(e.id, "2052-01-01");
    const s = await w.spell(e.id, "2052-04-01", "2052-04-02", 2);
    const april = await periodOf(w.org, w.payroll, 2052, 4);
    const run = await runPayroll(w.payroll, april.id);
    near(num((await w.record(run.id, e.id)).earnedGross), 16_000);
    await db.payrollPeriod.update({ where: { id: april.id }, data: { status: "LOCKED" } });
    await cancelSickSpell(await w.hr(), s.id, "Certificate was not genuine");
    // May: the first payroll calculated after the cancellation
    const mayPeriod = await periodOf(w.org, w.payroll, 2052, 5);
    const may = await runPayroll(w.payroll, mayPeriod.id);
    const found = await w.finding(may.id, e.id, "SICK_PAY_WITHDRAWN");
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("CRITICAL");
    expect(found[0].message).toContain("2052-04-01, 2052-04-02");
    expect(found[0].message).toContain("16,000.00");
    expect(found[0].message).toMatch(/deduction/i);
    expect(found[0].message).not.toContain("not genuine"); // the reason stays on the spell
    // no negative pay: the person has no May record at all (no hours, no sick days)
    expect(await db.payrollRecord.count({ where: { runId: may.id, employeeId: e.id } })).toBe(0);
    expect((await db.sickSpell.findUniqueOrThrow({ where: { id: s.id } })).overpaymentRunId).toBe(may.id);
    // calculated again: the same run keeps the finding
    const again = await runPayroll(w.payroll, mayPeriod.id);
    expect(again.id).toBe(may.id);
    expect(await w.finding(may.id, e.id, "SICK_PAY_WITHDRAWN")).toHaveLength(1);
    // a later payroll does not repeat it
    const june = await runPayroll(w.payroll, (await periodOf(w.org, w.payroll, 2052, 6)).id);
    expect(await w.finding(june.id, e.id, "SICK_PAY_WITHDRAWN")).toHaveLength(0);
  });

  it("a replacement spell for the same days is not paid twice and raises no finding", async () => {
    const w = await world();
    const e = await w.person("Replaced");
    await w.usualWeek(e.id, "2053-01-06");
    const s = await w.spell(e.id, "2053-03-03", "2053-03-04", 2); // Monday and Tuesday
    const march = await periodOf(w.org, w.payroll, 2053, 3);
    const run = await runPayroll(w.payroll, march.id);
    near(num((await w.record(run.id, e.id)).earnedGross), 16_000);
    await db.payrollPeriod.update({ where: { id: march.id }, data: { status: "LOCKED" } });
    await cancelSickSpell(await w.hr(), s.id, "Wrong certificate attached");
    await w.spell(e.id, "2053-03-03", "2053-03-04", 2); // the corrected spell, same days
    // the days are covered by an approved spell again, so nothing was overpaid: no finding in the next payroll, and nothing is paid a second time
    const april = await runPayroll(w.payroll, (await periodOf(w.org, w.payroll, 2053, 4)).id);
    expect(await w.finding(april.id, e.id, "SICK_PAY_WITHDRAWN")).toHaveLength(0);
    expect(await db.hourlyAllowanceLine.count({ where: { runId: april.id, employeeId: e.id, kind: "SICK_DAY" } })).toBe(0);
    expect((await db.sickSpell.findUniqueOrThrow({ where: { id: s.id } })).overpaymentRunId).toBeNull();
  });
});
