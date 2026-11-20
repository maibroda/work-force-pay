import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { num } from "@/lib/money";
import { payableSegments } from "@/lib/payroll/time-entry";
import { DEFAULT_EARNINGS } from "@/lib/payroll/structure";
import { createEmployee } from "@/server/services/employees";
import { createPeriod, openCriticalCount, runPayroll } from "@/server/services/payroll";
import { loadHourlyForPeriod } from "@/server/services/hourly-payroll";
import { loadRateBook } from "@/server/services/rates";
import { createStructure } from "@/server/services/structures";
import { ctxFor, uid } from "../helpers";

/**
 * Hourly pay, phase 4b (docs/plans/hourly-payroll-phase4-plan.md): the pay run reads an hourly person's APPROVED hours and pays them through the engine of phase 4a. The founder's answers of 2026-11-20:
 * H8 each site's hours follow the established salary structure for the location; H12 hourly pay is the person's gross earnings, taxed as monthly staff; H20 a person with a personal monthly pay rate who is
 * paid by the hour blocks the payroll; H21 hours still waiting for approval are left out and block approving the payroll. The tests run real payrolls in the demo company for a far-future month (April
 * and May 2037, which no other test uses) and put the hourly facts in directly (an approved shift is a TimeEntry with its paid pieces), so the company's shared hourly switch is never touched.
 * Rates are INVENTED: role weekday 1,000, weekend 1,500, holiday 2,000 an hour. Calendar: 2037-04-06 is a Monday, 11 a Saturday, 12 a Sunday.
 */
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const near = (actual: number, expected: number) => expect(Math.abs(actual - expected)).toBeLessThan(0.06); // each earnings line is rounded to the kobo (nine lines)
const wat = (s: string) => new Date(`${s}:00+01:00`);

async function world(tag = uid()) {
  const hr = await ctxFor("HR_ADMIN");
  const payroll = await ctxFor("PAYROLL_ADMIN");
  const org = payroll.orgId;
  const cat = await db.employeeCategory.findFirstOrThrow({ where: { organizationId: org, code: "GUARD" } });
  const other = await db.employeeCategory.findFirstOrThrow({ where: { organizationId: org, code: "OFF" } });
  const structure = await createStructure(payroll, {
    code: `HP-${tag}`, name: `Hourly ${tag}`, effectiveFrom: "2035-01-01", activate: true,
    components: DEFAULT_EARNINGS.map((c, i) => ({ code: c.code, name: c.name, calcType: "PERCENTAGE" as const, percentage: [10, 14, 15, 5, 15, 20, 2.5, 5, 13.5][i], taxable: true, pensionable: c.pensionable })),
  });
  const client = await db.client.create({ data: { organizationId: org, code: `HC${tag}`, name: `Hourly Client ${tag}` } });
  const contract = await db.contract.create({ data: { organizationId: org, clientId: client.id, contractNumber: `HK${tag}`, name: `Hourly guarding ${tag}`, startDate: day("2035-01-01") } });
  const beat = await db.beat.create({ data: { organizationId: org, clientId: client.id, contractId: contract.id, code: `HB${tag}`, name: `Hourly site ${tag}`, state: "Lagos" } });
  await db.contractRate.create({ data: { organizationId: org, contractId: contract.id, categoryId: cat.id, salaryStructureId: structure.id, agreedRate: "200000", effectiveFrom: day("2035-01-01") } });
  // the demo company is shared by the tests of this file, so the role's hourly rate is made once (two approved rates at one level is refused, as it should be)
  if (!(await db.hourlyRate.findFirst({ where: { organizationId: org, scope: "CATEGORY", categoryId: cat.id, status: "APPROVED", effectiveTo: null } })))
    await db.hourlyRate.create({ data: { organizationId: org, scope: "CATEGORY", categoryId: cat.id, weekdayRate: "1000", weekendRate: "1500", holidayRate: "2000", effectiveFrom: day("2035-01-01"), reason: "test", status: "APPROVED", proposedBy: "t", proposedByUserId: "t", decidedBy: "t2", decidedByUserId: "t2" } });
  let n = 0;
  const person = async (label: string, hourlyFrom: string | null, categoryId = cat.id) => {
    n += 1;
    const e = await createEmployee(hr, { firstName: "Hp", lastName: `${label}${tag}`, employmentDate: "2035-01-01", categoryId, bankName: "GTBank", accountNumber: `79${String(Date.now()).slice(-7)}${n}`, accountName: `HP ${label}` } as never);
    if (hourlyFrom) await db.employeeCompensationType.create({ data: { organizationId: org, employeeId: e.id, type: "HOURLY", effectiveFrom: day(hourlyFrom), reason: "test", status: "APPROVED", proposedBy: "t", proposedByUserId: "t", decidedBy: "t", decidedByUserId: "t2" } });
    return e;
  };
  /** An APPROVED shift with its paid pieces, as the time entry service leaves it (the same pure rules cut it at Nigerian midnight and class it). */
  const shift = async (employeeId: string, from: string, to: string, status: "APPROVED" | "SUBMITTED" | "DRAFT" = "APPROVED") => {
    const cin = wat(from);
    const cout = wat(to);
    const segs = payableSegments(cin, cout, [], new Set());
    const minutes = (cout.getTime() - cin.getTime()) / 60000;
    const e = await db.timeEntry.create({
      data: {
        organizationId: org, employeeId, clientId: client.id, contractId: contract.id, beatId: beat.id, clockIn: cin, clockOut: cout, status,
        capturedBy: "cap", capturedByUserId: "cap-user",
        ...(status === "APPROVED" ? { decidedBy: "dec", decidedByUserId: "dec-user", decidedAt: new Date(), placeState: "Lagos", calendarConfirmed: true, payableMinutes: minutes } : status === "SUBMITTED" ? { submittedAt: new Date() } : {}),
      },
    });
    if (status === "APPROVED") await db.timeEntrySegment.createMany({ data: segs.map((s) => ({ organizationId: org, entryId: e.id, date: day(s.date), dayClass: s.dayClass, minutes: s.minutes })) });
    return e;
  };
  const record = (runId: string, employeeId: string) => db.payrollRecord.findFirstOrThrow({ where: { runId, employeeId } });
  const issues = (runId: string, employeeId: string) => db.payrollValidationIssue.findMany({ where: { runId, employeeId } });
  return { hr, payroll, org, cat, other, structure, client, contract, beat, person, shift, record, issues, tag };
}

describe("the pay run pays an hourly person's approved hours", () => {
  it("earned gross is the approved hours at the approved rates, split by the site's structure, with pension and PAYE worked as for monthly staff", async () => {
    const w = await world();
    const e = await w.person("Pay", "2035-01-01");
    await w.shift(e.id, "2037-04-06T08:00", "2037-04-06T16:00"); // Monday: 8 h weekday = 8,000
    await w.shift(e.id, "2037-04-11T08:00", "2037-04-11T16:00"); // Saturday: 8 h weekend = 12,000
    const period = await createPeriod(w.payroll, 2037, 4);
    const run = await runPayroll(w.payroll, period.id);
    const rec = await w.record(run.id, e.id);
    near(num(rec.earnedGross), 20_000);
    near(num(rec.pensionBase), 7_800); // 39% of 20,000: the structure's Basic 10, Housing 14, Transport 15
    expect(num(rec.monthlyGross)).toBe(0); // an hourly person has no fixed monthly gross
    expect(num(rec.daysWorked)).toBe(2);
    expect(num(rec.netPay)).toBeCloseTo(num(rec.totalEarnings) - num(rec.totalDeductions), 2);
    expect(num(rec.clientBilling)).toBe(0); // no client billing for hourly staff (H15, H19)
    expect(num(rec.managementShare)).toBe(0);
    const lines = await db.hourlyPayLine.findMany({ where: { recordId: rec.id }, orderBy: { dayClass: "asc" } });
    expect(lines.map((l) => [l.dayClass, l.minutes, num(l.rate), num(l.amount)])).toEqual([["WEEKDAY", 480, 1000, 8000], ["WEEKEND", 480, 1500, 12000]]);
    expect(lines.every((l) => l.employeeId === e.id && l.runId === run.id && l.beatId === w.beat.id && l.contractId === w.contract.id && l.structureCode === w.structure.code)).toBe(true);
    expect(lines.flatMap((l) => l.entryIds)).toHaveLength(2); // every line can be traced to the shifts it came from
    const alloc = await db.payrollAllocation.findFirstOrThrow({ where: { recordId: rec.id } });
    expect([alloc.beatId, num(alloc.days), num(alloc.grossAmount)]).toEqual([w.beat.id, 2, 20_000]);
  });

  it("recalculating replaces the stored lines instead of adding to them, and the pay does not change", async () => {
    const w = await world();
    const e = await w.person("Recalc", "2035-01-01");
    await w.shift(e.id, "2037-04-07T08:00", "2037-04-07T16:00");
    const period = await db.payrollPeriod.findFirstOrThrow({ where: { organizationId: w.org, year: 2037, month: 4 } }).catch(() => createPeriod(w.payroll, 2037, 4));
    const first = await runPayroll(w.payroll, period.id);
    const a = await w.record(first.id, e.id);
    const second = await runPayroll(w.payroll, period.id);
    const b = await w.record(second.id, e.id);
    expect(second.id).toBe(first.id);
    expect(num(b.earnedGross)).toBe(num(a.earnedGross));
    expect(await db.hourlyPayLine.count({ where: { runId: second.id, employeeId: e.id } })).toBe(1);
  });

  it("hours are paid in the month they were worked: a Friday-to-Saturday shift over the month end is paid half in each month, nothing lost or twice", async () => {
    const w = await world();
    const e = await w.person("Edge", "2035-01-01");
    await w.shift(e.id, "2037-04-30T19:00", "2037-05-01T07:00"); // Thursday 30 April 19:00 to Friday 1 May 07:00: 5 h and 7 h, both weekdays
    const april = await db.payrollPeriod.findFirstOrThrow({ where: { organizationId: w.org, year: 2037, month: 4 } }).catch(() => createPeriod(w.payroll, 2037, 4));
    const may = await db.payrollPeriod.findFirstOrThrow({ where: { organizationId: w.org, year: 2037, month: 5 } }).catch(() => createPeriod(w.payroll, 2037, 5));
    const ra = await runPayroll(w.payroll, april.id);
    const rm = await runPayroll(w.payroll, may.id);
    near(num((await w.record(ra.id, e.id)).earnedGross), 5_000);
    near(num((await w.record(rm.id, e.id)).earnedGross), 7_000);
  });
});

describe("only approved hours are paid (H9, H21)", () => {
  it("a shift waiting for approval, and a draft with no clock-out, are left out and each makes a blocking finding that says what is left out", async () => {
    const w = await world();
    const e = await w.person("Waiting", "2035-01-01");
    await w.shift(e.id, "2037-04-06T08:00", "2037-04-06T16:00"); // approved: 8,000
    await w.shift(e.id, "2037-04-07T08:00", "2037-04-07T16:00", "SUBMITTED"); // waiting
    await db.timeEntry.create({ data: { organizationId: w.org, employeeId: e.id, clientId: w.client.id, contractId: w.contract.id, beatId: w.beat.id, clockIn: wat("2037-04-08T08:00"), capturedBy: "cap", capturedByUserId: "cap-user" } }); // no clock-out
    const period = await db.payrollPeriod.findFirstOrThrow({ where: { organizationId: w.org, year: 2037, month: 4 } }).catch(() => createPeriod(w.payroll, 2037, 4));
    const run = await runPayroll(w.payroll, period.id);
    near(num((await w.record(run.id, e.id)).earnedGross), 8_000); // only the approved shift is paid
    const found = (await w.issues(run.id, e.id)).filter((i) => i.code === "HOURLY_HOURS_NOT_APPROVED");
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("CRITICAL");
    expect(found[0].message).toMatch(/2 shift/);
    expect(found[0].message).toMatch(/not paid/i);
    expect(await openCriticalCount(run.id)).toBeGreaterThan(0); // an open critical finding is what stops the payroll being approved (the approver can override it, with a reason)
  });

  it("a person whose hours are all approved has no such finding", async () => {
    const w = await world();
    const e = await w.person("Clean", "2035-01-01");
    await w.shift(e.id, "2037-04-06T08:00", "2037-04-06T16:00");
    const period = await db.payrollPeriod.findFirstOrThrow({ where: { organizationId: w.org, year: 2037, month: 4 } }).catch(() => createPeriod(w.payroll, 2037, 4));
    const run = await runPayroll(w.payroll, period.id);
    expect((await w.issues(run.id, e.id)).filter((i) => i.code.startsWith("HOURLY_"))).toEqual([]);
  });
});

describe("hours that cannot be priced are not paid and are never paid as zero", () => {
  it("a job role with no approved hourly rate: the hours are left out and a blocking finding names them", async () => {
    const w = await world();
    const e = await w.person("NoRate", "2035-01-01", w.other.id); // the office role has no hourly rate
    await w.shift(e.id, "2037-04-06T08:00", "2037-04-06T16:00");
    const period = await db.payrollPeriod.findFirstOrThrow({ where: { organizationId: w.org, year: 2037, month: 4 } }).catch(() => createPeriod(w.payroll, 2037, 4));
    const run = await runPayroll(w.payroll, period.id);
    const found = (await w.issues(run.id, e.id)).filter((i) => i.code === "HOURLY_NO_RATE");
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("CRITICAL");
    expect(found[0].message).toMatch(/8 h/);
    expect(await db.hourlyPayLine.count({ where: { runId: run.id, employeeId: e.id } })).toBe(0);
  });
});

describe("a person is never paid monthly and hourly for the same day (H20)", () => {
  it("work-register days on the days a person is paid by the hour are not paid monthly", async () => {
    const w = await world();
    const e = await w.person("Both", "2035-01-01");
    // the register defaults a present day to 12 hours, and a monthly rate exists through the contract: none of it is paid for an hourly person
    for (const dd of ["2037-04-06", "2037-04-07", "2037-04-08"]) await db.workRegister.create({ data: { organizationId: w.org, date: day(dd), employeeId: e.id, clientId: w.client.id, contractId: w.contract.id, beatId: w.beat.id, categoryId: w.cat.id, attendanceStatus: "PRESENT", hoursWorked: 12, recordedBy: "t" } });
    await w.shift(e.id, "2037-04-06T08:00", "2037-04-06T16:00");
    const period = await db.payrollPeriod.findFirstOrThrow({ where: { organizationId: w.org, year: 2037, month: 4 } }).catch(() => createPeriod(w.payroll, 2037, 4));
    const run = await runPayroll(w.payroll, period.id);
    near(num((await w.record(run.id, e.id)).earnedGross), 8_000); // the approved shift only
  });

  it("a person who is hourly and also has a personal monthly pay rate blocks the payroll, and is not paid the monthly rate for the hourly days", async () => {
    const w = await world();
    const e = await w.person("Rate", "2035-01-01");
    await db.employeePayRate.create({ data: { organizationId: w.org, employeeId: e.id, monthlyGross: "300000", structureCode: w.structure.code, reason: "Office", approvedBy: "Someone", effectiveFrom: day("2035-01-01") } });
    await w.shift(e.id, "2037-04-06T08:00", "2037-04-06T16:00");
    const period = await db.payrollPeriod.findFirstOrThrow({ where: { organizationId: w.org, year: 2037, month: 4 } }).catch(() => createPeriod(w.payroll, 2037, 4));
    const run = await runPayroll(w.payroll, period.id);
    const found = (await w.issues(run.id, e.id)).filter((i) => i.code === "HOURLY_AND_MONTHLY_RATE");
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("CRITICAL");
    near(num((await w.record(run.id, e.id)).earnedGross), 8_000); // never the monthly 300,000 as well
  });

  it("monthly for the first half of the month and hourly from the 16th: the monthly days are paid by the days, the hourly part is added", async () => {
    const w = await world();
    const e = await w.person("Switch", "2037-04-16");
    for (let i = 1; i <= 30; i++) await db.workRegister.create({ data: { organizationId: w.org, date: day(`2037-04-${String(i).padStart(2, "0")}`), employeeId: e.id, clientId: w.client.id, contractId: w.contract.id, beatId: w.beat.id, categoryId: w.cat.id, attendanceStatus: "PRESENT", hoursWorked: 12, recordedBy: "t" } });
    await w.shift(e.id, "2037-04-20T08:00", "2037-04-20T16:00"); // Monday 20 April: 8 h = 8,000
    const period = await db.payrollPeriod.findFirstOrThrow({ where: { organizationId: w.org, year: 2037, month: 4 } }).catch(() => createPeriod(w.payroll, 2037, 4));
    const run = await runPayroll(w.payroll, period.id);
    // the contract rate's operative gross (70% of 200,000 = 140,000) for 15 of 30 days = 70,000, plus 8,000 of hourly pay
    near(num((await w.record(run.id, e.id)).earnedGross), 78_000);
  });
});

describe("the established salary structure for the location (H8)", () => {
  it("is the contract rate's structure for the job role, then the contract's default, then the company's default", async () => {
    const w = await world();
    const book = await loadRateBook(db, w.org, day("2037-04-01"), day("2037-04-30"), 70);
    expect(book.structureFor(w.contract.id, w.cat.id, day("2037-04-10"))?.id).toBe(w.structure.id); // the contract rate's
    // a role with no contract rate falls to the contract's default structure, if it has one
    const own = await createStructure(w.payroll, { code: `HD-${w.tag}`, name: `Contract default ${w.tag}`, effectiveFrom: "2035-01-01", activate: true, components: [{ code: "BASIC", name: "Basic", calcType: "PERCENTAGE" as const, percentage: 100, taxable: true, pensionable: true }] });
    expect(book.structureFor(w.contract.id, w.other.id, day("2037-04-10"))).not.toBeNull(); // the company default: never none while the company has one
    await db.contract.update({ where: { id: w.contract.id }, data: { defaultStructureId: own.id } });
    const book2 = await loadRateBook(db, w.org, day("2037-04-01"), day("2037-04-30"), 70);
    expect(book2.structureFor(w.contract.id, w.other.id, day("2037-04-10"))?.id).toBe(own.id); // the contract's default
    expect(book2.structureFor(w.contract.id, w.cat.id, day("2037-04-10"))?.id).toBe(w.structure.id); // the contract rate still wins
  });
});

describe("a mistake in one person's rates never stops the company's payroll", () => {
  it("two approved rates in force at the same level for one job role: the people on that role are not paid and get a blocking finding, and everyone else is paid as ever", async () => {
    const w = await world();
    const office = await w.person("Office", "2035-01-01", w.other.id);
    const monthly = await w.person("MonthlyOk", null);
    await db.employeePayRate.create({ data: { organizationId: w.org, employeeId: monthly.id, monthlyGross: "300000", structureCode: w.structure.code, reason: "Office", approvedBy: "Someone", effectiveFrom: day("2035-01-01") } });
    // two overlapping approved rates for the office role (entered directly: the service would refuse the second)
    for (const w2 of ["1100", "1200"]) await db.hourlyRate.create({ data: { organizationId: w.org, scope: "CATEGORY", categoryId: w.other.id, weekdayRate: w2, weekendRate: w2, holidayRate: w2, effectiveFrom: day("2035-01-01"), reason: "test", status: "APPROVED", proposedBy: "t", proposedByUserId: "t", decidedBy: "t2", decidedByUserId: "t2" } });
    await w.shift(office.id, "2037-04-06T08:00", "2037-04-06T16:00");
    const period = await db.payrollPeriod.findFirstOrThrow({ where: { organizationId: w.org, year: 2037, month: 4 } }).catch(() => createPeriod(w.payroll, 2037, 4));
    const run = await runPayroll(w.payroll, period.id);
    const found = (await w.issues(run.id, office.id)).filter((i) => i.code === "HOURLY_RATE_CONFLICT");
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("CRITICAL");
    expect(found[0].message).toMatch(/Two approved hourly rates/);
    expect(await db.hourlyPayLine.count({ where: { runId: run.id, employeeId: office.id } })).toBe(0);
    near(num((await w.record(run.id, monthly.id)).earnedGross), 300_000); // the rest of the payroll was worked
  });
});

describe("what is not changed", () => {
  it("a monthly person in the same payroll is paid exactly as before, and another company's hours are never read", async () => {
    const w = await world();
    const monthly = await w.person("Monthly", null);
    await db.employeePayRate.create({ data: { organizationId: w.org, employeeId: monthly.id, monthlyGross: "300000", structureCode: w.structure.code, reason: "Office", approvedBy: "Someone", effectiveFrom: day("2035-01-01") } });
    const hourly = await w.person("Hourly", "2035-01-01");
    await w.shift(hourly.id, "2037-04-06T08:00", "2037-04-06T16:00");
    const period = await db.payrollPeriod.findFirstOrThrow({ where: { organizationId: w.org, year: 2037, month: 4 } }).catch(() => createPeriod(w.payroll, 2037, 4));
    const run = await runPayroll(w.payroll, period.id);
    near(num((await w.record(run.id, monthly.id)).earnedGross), 300_000);
    expect(await db.hourlyPayLine.count({ where: { runId: run.id, employeeId: monthly.id } })).toBe(0);
    expect((await w.issues(run.id, monthly.id)).filter((i) => i.code.startsWith("HOURLY_"))).toEqual([]);
    // a second company with hourly hours does not appear in this company's payroll
    const { isolatedOrg } = await import("../helpers");
    const t = await isolatedOrg();
    const stranger = await createEmployee(t.ctx("HR_ADMIN"), { firstName: "Str", lastName: "Anger", employmentDate: "2035-01-01", categoryId: t.guardId } as never);
    const c = await db.client.create({ data: { organizationId: t.org.id, code: `S${uid()}`, name: "Other" } });
    const k = await db.contract.create({ data: { organizationId: t.org.id, clientId: c.id, contractNumber: `S${uid()}`, name: "Other", startDate: day("2035-01-01") } });
    const b = await db.beat.create({ data: { organizationId: t.org.id, clientId: c.id, contractId: k.id, code: `S${uid()}`, name: "Other site" } });
    const te = await db.timeEntry.create({ data: { organizationId: t.org.id, employeeId: stranger.id, clientId: c.id, contractId: k.id, beatId: b.id, clockIn: wat("2037-04-06T08:00"), clockOut: wat("2037-04-06T16:00"), status: "APPROVED", capturedBy: "x", capturedByUserId: "x", decidedBy: "y", decidedByUserId: "y2", decidedAt: new Date(), payableMinutes: 480 } });
    await db.timeEntrySegment.create({ data: { organizationId: t.org.id, entryId: te.id, date: day("2037-04-06"), dayClass: "WEEKDAY", minutes: 480 } });
    const again = await runPayroll(w.payroll, period.id);
    expect(await db.hourlyPayLine.count({ where: { runId: again.id, employeeId: stranger.id } })).toBe(0);
    expect(await db.payrollRecord.count({ where: { runId: again.id, employeeId: stranger.id } })).toBe(0);
    const loaded = await loadHourlyForPeriod(db, w.org, day("2037-04-01"), day("2037-04-30"));
    expect(loaded.pieces.some((p) => p.employeeId === stranger.id)).toBe(false); // the loader itself reads this company only
  });
});
