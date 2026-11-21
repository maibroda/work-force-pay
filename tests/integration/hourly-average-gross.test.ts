import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { num } from "@/lib/money";
import { payableSegments } from "@/lib/payroll/time-entry";
import { DEFAULT_EARNINGS } from "@/lib/payroll/structure";
import { createEmployee } from "@/server/services/employees";
import { createPeriod, runPayroll } from "@/server/services/payroll";
import { copyStatutoryRules, createPayrollRule, payrollRuleFor } from "@/server/services/statutory";
import { createStructure } from "@/server/services/structures";
import { ctxFor, isolatedOrg, uid } from "../helpers";

/**
 * Hourly pay, the three-month average on GROSS EARNINGS (the founder's confirmed decision of 2026-11-21): a paid sick day and a paid public holiday not worked are paid at the person's AVERAGE DAILY GROSS EARNINGS (the gross pay for
 * the hours worked in the months before, each shift at the approved rate of its own day, divided by the days worked), not at the average hours times the weekday rate. It is a RULE SETTING (gross earnings for a new version; a version
 * made before the decision keeps the first build's method, so no past or open payroll changes), with the kinds of day that count. The stored line keeps how the average was worked out. Real payrolls in the demo company for
 * February and March 2058, March 2059 and March 2060 (no other test uses these years). Rates are INVENTED: role weekday 1,000, weekend 1,500 an hour.
 * Calendar: 2058-01-07, 2058-02-11 and 2058-03-04 are Mondays and 2058-01-12 a Saturday; 2059-01-06 and 2059-03-03 are Mondays and 2059-01-11 a Saturday; 2060-01-05 and 2060-03-01 are Mondays and 2060-01-10 a Saturday.
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
  return { payroll, org, person, shift, usualWeek, spell, record, sick, finding, beat };
}


let payrollCtx: Awaited<ReturnType<typeof ctxFor>>;

/** A rule version for ONE year only, CLOSED, made directly from the demo company's rule (which is on the first build's method): the demo company keeps exactly one open-ended rule. */
async function ruleFor(year: number, over: Record<string, unknown>) {
  const current = await db.payrollRule.findFirstOrThrow({ where: { organizationId: payrollCtx.orgId, effectiveTo: null } });
  const { id: _id, createdAt: _created, ...fields } = current;
  void _id;
  void _created;
  await db.payrollRule.create({ data: { ...fields, version: `avg-${year}-${uid()}`, effectiveFrom: day(`${year}-01-01`), effectiveTo: day(`${year}-12-31`), ...over } });
}

beforeAll(async () => {
  payrollCtx = await ctxFor("PAYROLL_ADMIN");
  const org = payrollCtx.orgId;
  await ruleFor(2058, { hourlyAverageBasis: "GROSS_EARNINGS" }); // gross earnings, all kinds of day count
  await ruleFor(2059, { hourlyAverageBasis: "HOURS_AT_WEEKDAY_RATE" }); // the first build's method
  await ruleFor(2060, { hourlyAverageBasis: "GROSS_EARNINGS", hourlyAverageWeekend: false }); // gross earnings, weekend hours do not count
  const h = await db.publicHoliday.create({ data: { organizationId: org, date: day("2058-02-11"), name: "Test Lagos holiday (Monday)", createdBy: "test" } });
  await db.publicHolidayState.create({ data: { organizationId: org, holidayId: h.id, state: "Lagos", createdBy: "test" } });
}, 120_000);

const periodOf = async (year: number, month: number) => (await db.payrollPeriod.findFirst({ where: { organizationId: payrollCtx.orgId, year, month } })) ?? createPeriod(payrollCtx, year, month);

/** Three weekdays at the weekday rate (8 h each, 8,000 a day) and a Saturday at the weekend rate (8 h at 1,500 = 12,000): 36,000 over 4 days = 9,000 a day on the gross basis, 8 h x 1,000 = 8,000 on the first build's. */
const history = async (w: Awaited<ReturnType<typeof world>>, employeeId: string, days: { weekdays: string[]; saturday: string }) => {
  for (const date of days.weekdays) await w.shift(employeeId, `${date}T08:00`, `${date}T16:00`);
  await w.shift(employeeId, `${days.saturday}T08:00`, `${days.saturday}T16:00`);
};
const Y58 = { weekdays: ["2058-01-07", "2058-01-08", "2058-01-09"], saturday: "2058-01-12" };
const Y59 = { weekdays: ["2059-01-06", "2059-01-07", "2059-01-08"], saturday: "2059-01-11" };
const Y60 = { weekdays: ["2060-01-05", "2060-01-06", "2060-01-07"], saturday: "2060-01-10" };

describe("a paid sick day on the GROSS EARNINGS basis (the founder's decision)", () => {
  it("is the average daily gross earnings: 36,000 of gross over 4 days worked is 9,000 a day, so 2 sick days are 18,000 (the first build would pay 16,000); the line keeps the breakdown", async () => {
    const w = await world();
    const e = await w.person("Gross");
    await history(w, e.id, Y58);
    await w.spell(e.id, "2058-03-04", "2058-03-05", 2); // Monday and Tuesday
    const run = await runPayroll(w.payroll, (await periodOf(2058, 3)).id);
    const rec = await w.record(run.id, e.id);
    near(num(rec.earnedGross), 18_000);
    const lines = await w.sick(rec.id);
    expect(lines).toHaveLength(1);
    expect([num(lines[0].amount), lines[0].minutes, lines[0].rate, lines[0].dates]).toEqual([18_000, 960, null, ["2058-03-04", "2058-03-05"]]);
    expect(lines[0].breakdown).toEqual({ basis: "GROSS_EARNINGS", from: "2057-12-04", to: "2058-03-04", grossEarnings: "36000.00", daysWorked: 4, dailyAverage: "9000.00", daysPaid: 2, counted: ["WEEKDAY", "WEEKEND", "HOLIDAY"], unpricedMinutes: 0 });
    expect(await w.finding(run.id, e.id, "SICK_NO_RATE")).toHaveLength(0); // no weekday rate is needed on this basis
  });

  it("counts only the kinds of day the rule counts: with weekend hours left out the average is 8,000 over 3 weekdays, so 2 days are 16,000", async () => {
    const w = await world();
    const e = await w.person("Classes");
    await history(w, e.id, Y60);
    await w.spell(e.id, "2060-03-01", "2060-03-02", 2); // Monday and Tuesday
    const run = await runPayroll(w.payroll, (await periodOf(2060, 3)).id);
    const rec = await w.record(run.id, e.id);
    near(num(rec.earnedGross), 16_000);
    expect((await w.sick(rec.id))[0].breakdown).toMatchObject({ grossEarnings: "24000.00", daysWorked: 3, dailyAverage: "8000.00", counted: ["WEEKDAY", "HOLIDAY"] });
  });

  it("an employee with no hours at all has nothing to average: nothing is paid and a blocking finding says the earnings are missing", async () => {
    const w = await world();
    const e = await w.person("Nothing");
    await w.spell(e.id, "2058-03-04", "2058-03-05", 2);
    const run = await runPayroll(w.payroll, (await periodOf(2058, 3)).id);
    expect(await db.hourlyAllowanceLine.count({ where: { runId: run.id, employeeId: e.id, kind: "SICK_DAY" } })).toBe(0);
    const found = await w.finding(run.id, e.id, "SICK_NO_AVERAGE");
    expect(found).toHaveLength(1);
    expect(found[0].message).toMatch(/earnings/);
  });
});

describe("a paid public holiday not worked on the GROSS EARNINGS basis", () => {
  it("is the same average daily gross: 9,000 for the Lagos holiday on Monday 11 February 2058, kept with its breakdown", async () => {
    const w = await world();
    const e = await w.person("Holiday");
    await history(w, e.id, Y58);
    const run = await runPayroll(w.payroll, (await periodOf(2058, 2)).id);
    const rec = await w.record(run.id, e.id);
    const lines = await db.hourlyAllowanceLine.findMany({ where: { recordId: rec.id, kind: "HOLIDAY_NOT_WORKED" } });
    expect(lines).toHaveLength(1);
    expect([num(lines[0].amount), lines[0].minutes, lines[0].rate, lines[0].dates]).toEqual([9_000, 480, null, ["2058-02-11"]]);
    expect(lines[0].breakdown).toMatchObject({ basis: "GROSS_EARNINGS", grossEarnings: "36000.00", daysWorked: 4, dailyAverage: "9000.00", daysPaid: 1 });
  });
});

describe("a rule version made before the decision keeps the first build's method, so nothing past or open changes", () => {
  it("2059 is on the average hours x the weekday rate: 2 sick days are 16,000 at the rate of 1,000, and the line has no breakdown", async () => {
    const w = await world();
    const e = await w.person("Old");
    await history(w, e.id, Y59);
    await w.spell(e.id, "2059-03-03", "2059-03-04", 2); // Monday and Tuesday
    const run = await runPayroll(w.payroll, (await periodOf(2059, 3)).id);
    const rec = await w.record(run.id, e.id);
    near(num(rec.earnedGross), 16_000);
    const lines = await w.sick(rec.id);
    expect([num(lines[0].amount), num(lines[0].rate), lines[0].breakdown]).toEqual([16_000, 1000, null]);
  });
});

describe("the method is a rule setting: effective-dated, versioned, defaulted for new versions only, audited and copied", () => {
  it("a new version starts on GROSS_EARNINGS with every kind of day counted, the first build's method can be chosen, anything else is refused, one kind at least must count, and a new company copies it", async () => {
    const t = await isolatedOrg();
    const u = await db.user.create({ data: { organizationId: t.org.id, email: `av.${uid()}@av.test`.toLowerCase(), name: "Admin", role: "COMPANY_ADMIN", passwordHash: "x" } });
    const admin = { userId: u.id, orgId: t.org.id, role: "COMPANY_ADMIN" as const, name: u.name, email: u.email, employeeId: null };
    const base = { prorationBasis: "CALENDAR_DAYS", defaultOperativeSharePct: 70, standardHoursPerDay: 12, overtimeMultiplier: 1.5, maxOvertimeHoursPerMonth: 60, maxDeductionPctOfGross: 33.33, backOfficeChargePct: 15 };
    const first = await createPayrollRule(admin, { ...base, version: "a", effectiveFrom: "2027-01-01" } as never);
    expect([first.hourlyAverageBasis, first.hourlyAverageWeekday, first.hourlyAverageWeekend, first.hourlyAverageHoliday]).toEqual(["GROSS_EARNINGS", true, true, true]);
    const second = await createPayrollRule(admin, { ...base, version: "b", effectiveFrom: "2028-01-01", hourlyAverageBasis: "HOURS_AT_WEEKDAY_RATE", hourlyAverageWeekend: false } as never);
    expect([second.hourlyAverageBasis, second.hourlyAverageWeekend]).toEqual(["HOURS_AT_WEEKDAY_RATE", false]);
    await expect(createPayrollRule(admin, { ...base, version: "c", effectiveFrom: "2029-01-01", hourlyAverageBasis: "HOURS" } as never)).rejects.toThrow();
    await expect(createPayrollRule(admin, { ...base, version: "d", effectiveFrom: "2029-01-01", hourlyAverageWeekday: false, hourlyAverageWeekend: false, hourlyAverageHoliday: false } as never)).rejects.toThrow(/at least one kind of day/i);
    const rule2028 = await payrollRuleFor(db, t.org.id, new Date("2028-06-01T00:00:00Z"));
    expect([rule2028.hourlyAverageBasis, rule2028.hourlyAverageCounted]).toEqual(["HOURS_AT_WEEKDAY_RATE", ["WEEKDAY", "HOLIDAY"]]);
    const audit = await db.auditLog.findMany({ where: { organizationId: t.org.id, action: "PAYROLL_RULE_CHANGE" } });
    expect(JSON.stringify(audit.map((a) => a.newValue))).toContain("hourlyAverageBasis");
    const other = await isolatedOrg();
    await db.$transaction((tx) => copyStatutoryRules(tx, t.org.id, other.org.id));
    expect((await db.payrollRule.findMany({ where: { organizationId: other.org.id }, orderBy: { effectiveFrom: "asc" } })).map((r) => [r.hourlyAverageBasis, r.hourlyAverageWeekend])).toEqual([["GROSS_EARNINGS", true], ["HOURS_AT_WEEKDAY_RATE", false]]);
  });

  it("the demonstration company's own rule is on the first build's method (so its figures and older tests do not change), and a bare rule row made without a choice starts on the gross earnings", async () => {
    expect((await payrollRuleFor(db, payrollCtx.orgId, new Date("2026-06-01T00:00:00Z"))).hourlyAverageBasis).toBe("HOURS_AT_WEEKDAY_RATE");
    const t = await isolatedOrg();
    const bare = await db.payrollRule.create({ data: { organizationId: t.org.id, version: "bare", effectiveFrom: new Date("2027-01-01T00:00:00Z") } });
    expect([bare.hourlyAverageBasis, bare.hourlyAverageWeekday, bare.hourlyAverageWeekend, bare.hourlyAverageHoliday]).toEqual(["GROSS_EARNINGS", true, true, true]);
  });
});
