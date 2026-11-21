import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { payableSegments } from "@/lib/payroll/time-entry";
import { DEFAULT_EARNINGS } from "@/lib/payroll/structure";
import { buildReport } from "@/server/report-registry";
import { createEmployee } from "@/server/services/employees";
import { createPeriod, createSupplementaryRun, runPayroll } from "@/server/services/payroll";
import { createStructure } from "@/server/services/structures";
import { ctxFor, isolatedOrg, uid } from "../helpers";

/**
 * Hourly pay, H14 follow-up (docs/plans/hourly-reports-allowances-plan.md, option A): the hourly cost reports show the leave pay, the sick pay and the holiday pay that PAYROLL calculated, read from the stored payroll lines,
 * for each whole payroll month the dates touch (the latest calculation; a superseded run is ignored; a supplementary run counts too). The existing hours cost stays indicative and keeps its meaning. A month with no
 * calculated payroll shows 0 for the extra pays and is named in the description. Real payrolls in the demo company for January, February and March 2051 (no other test uses 2051); the company's leave percentage is a
 * closed rule version of 10 for 2051. Sick and holiday lines are added directly as stored lines on a real payroll record (the pay itself is proved by the sick and holiday tests).
 * Calendar: 2051-01-02, 2051-02-13, 2051-02-20, 2051-03-06 and 2051-04-03 are Mondays. Rates are INVENTED: role weekday 1,000 an hour.
 */
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const wat = (s: string) => new Date(`${s}:00+01:00`);
const rowOf = (rows: Array<Record<string, unknown>>, key: string, value: unknown) => rows.find((r) => r[key] === value);

async function world() {
  const tag = uid();
  const hr = await ctxFor("HR_ADMIN");
  const payroll = await ctxFor("PAYROLL_ADMIN");
  const org = payroll.orgId;
  const cat = await db.employeeCategory.findFirstOrThrow({ where: { organizationId: org, code: "GUARD" } });
  const structure = await createStructure(payroll, {
    code: `RA-${tag}`, name: `Report allowances ${tag}`, effectiveFrom: "2040-01-01", activate: true,
    components: DEFAULT_EARNINGS.map((c, i) => ({ code: c.code, name: c.name, calcType: "PERCENTAGE" as const, percentage: [10, 14, 15, 5, 15, 20, 2.5, 5, 13.5][i], taxable: true, pensionable: c.pensionable })),
  });
  const client = await db.client.create({ data: { organizationId: org, code: `RQ${tag}`, name: `Report allowances Client ${tag}` } });
  const contract = await db.contract.create({ data: { organizationId: org, clientId: client.id, contractNumber: `RQK${tag}`, name: `Report allowances guarding ${tag}`, startDate: day("2040-01-01") } });
  const beat = await db.beat.create({ data: { organizationId: org, clientId: client.id, contractId: contract.id, code: `RQB${tag}`, name: `Report allowances site ${tag}`, state: "Lagos" } });
  await db.contractRate.create({ data: { organizationId: org, contractId: contract.id, categoryId: cat.id, salaryStructureId: structure.id, agreedRate: "200000", effectiveFrom: day("2040-01-01") } });
  if (!(await db.hourlyRate.findFirst({ where: { organizationId: org, scope: "CATEGORY", categoryId: cat.id, status: "APPROVED", effectiveTo: null } })))
    await db.hourlyRate.create({ data: { organizationId: org, scope: "CATEGORY", categoryId: cat.id, weekdayRate: "1000", weekendRate: "1500", holidayRate: "2000", effectiveFrom: day("2030-01-01"), reason: "test", status: "APPROVED", proposedBy: "t", proposedByUserId: "t", decidedBy: "t", decidedByUserId: "t2", decidedAt: new Date() } });
  const person = async (label: string) => {
    const e = await createEmployee(hr, { firstName: "Ra", lastName: `${label}${tag}`, employmentDate: "2040-01-01", categoryId: cat.id, bankName: "GTBank", accountNumber: `75${String(Date.now()).slice(-7)}${label.length}`, accountName: `RA ${label}` } as never);
    await db.employeeCompensationType.create({ data: { organizationId: org, employeeId: e.id, type: "HOURLY", effectiveFrom: day("2040-01-01"), reason: "test", status: "APPROVED", proposedBy: "t", proposedByUserId: "t", decidedBy: "t", decidedByUserId: "t2", decidedAt: new Date() } });
    return e;
  };
  const shift = async (employeeId: string, from: string, to: string) => {
    const cin = wat(from);
    const cout = wat(to);
    const en = await db.timeEntry.create({ data: { organizationId: org, employeeId, clientId: client.id, contractId: contract.id, beatId: beat.id, clockIn: cin, clockOut: cout, status: "APPROVED", capturedBy: "cap", capturedByUserId: "cap-user", decidedBy: "dec", decidedByUserId: "dec-user", decidedAt: new Date(), placeState: "Lagos", calendarConfirmed: true, payableMinutes: (cout.getTime() - cin.getTime()) / 60000 } });
    await db.timeEntrySegment.createMany({ data: payableSegments(cin, cout, [], new Set()).map((s) => ({ organizationId: org, entryId: en.id, date: day(s.date), dayClass: s.dayClass, minutes: s.minutes })) });
  };
  const record = (runId: string, employeeId: string) => db.payrollRecord.findFirstOrThrow({ where: { runId, employeeId } });
  /** A stored sick or holiday line on a real payroll record (amount in naira). */
  const extra = async (runId: string, employeeId: string, kind: "SICK_DAY" | "HOLIDAY_NOT_WORKED", amount: string) => {
    const rec = await record(runId, employeeId);
    await db.hourlyAllowanceLine.create({ data: { organizationId: org, runId, recordId: rec.id, employeeId, kind, clientId: client.id, contractId: contract.id, beatId: beat.id, structureCode: structure.code, minutes: 600, rate: "1000", dates: ["2051-03-07"], amount } });
  };
  return { payroll, org, client, contract, person, shift, record, extra, tag };
}

const periodOf = async (orgId: string, ctx: Awaited<ReturnType<typeof ctxFor>>, year: number, month: number) => (await db.payrollPeriod.findFirst({ where: { organizationId: orgId, year, month } })) ?? createPeriod(ctx, year, month);

/** The demo company has hourly pay switched off (the pay run does not check, the reports do): switched on for this file, put back after. */
let setting: { enabled: boolean } | null = null;
afterAll(async () => {
  const org = (await ctxFor("PAYROLL_ADMIN")).orgId;
  if (setting) await db.hourlyPaySetting.update({ where: { organizationId: org }, data: { enabled: setting.enabled } });
  else await db.hourlyPaySetting.deleteMany({ where: { organizationId: org } });
});

beforeAll(async () => {
  const w = await world();
  setting = await db.hourlyPaySetting.findUnique({ where: { organizationId: w.org }, select: { enabled: true } });
  await db.hourlyPaySetting.upsert({ where: { organizationId: w.org }, update: { enabled: true }, create: { organizationId: w.org, enabled: true, changedBy: "test", changedByUserId: "test" } });
  const current = await db.payrollRule.findFirstOrThrow({ where: { organizationId: w.org, effectiveTo: null } });
  const { id: _id, createdAt: _created, ...fields } = current;
  void _id;
  void _created;
  await db.payrollRule.create({ data: { ...fields, version: `ra-2051-${w.tag}`, effectiveFrom: day("2051-01-01"), effectiveTo: day("2051-12-31"), hourlyLeavePct: "10" } });
}, 120_000);

describe("the hourly cost reports show the extra pays payroll calculated", () => {
  it("by employee: leave pay from the pay run and the stored sick and holiday lines, beside the indicative hours cost, with the total of both", async () => {
    const w = await world();
    const e = await w.person("Emp");
    await w.shift(e.id, "2051-03-06T08:00", "2051-03-06T18:00"); // Monday 10 h = 10,000 of hours, and 10% leave pay 1,000
    const run = await runPayroll(w.payroll, (await periodOf(w.org, w.payroll, 2051, 3)).id);
    await w.extra(run.id, e.id, "SICK_DAY", "3000");
    await w.extra(run.id, e.id, "HOLIDAY_NOT_WORKED", "2000");
    const r = (await buildReport(w.payroll, "hourly-summary", { from: "2051-03-01", to: "2051-03-31", employeeId: e.id }))!;
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ totalAmount: 10_000, leavePay: 1_000, sickPay: 3_000, holidayPay: 2_000, totalWithExtra: 16_000 });
    expect(r.totals).toMatchObject({ totalAmount: 10_000, leavePay: 1_000, sickPay: 3_000, holidayPay: 2_000, totalWithExtra: 16_000 });
    expect(r.columns.map((c) => c.key)).toEqual(expect.arrayContaining(["leavePay", "sickPay", "holidayPay", "totalWithExtra"]));
    // the extra pays are for the whole payroll month the dates touch: a week at the end of March with no hours still shows them
    const late = (await buildReport(w.payroll, "hourly-summary", { from: "2051-03-25", to: "2051-03-31", employeeId: e.id }))!;
    expect(late.rows).toHaveLength(1);
    expect(late.rows[0]).toMatchObject({ totalHours: 0, totalAmount: 0, leavePay: 1_000, sickPay: 3_000, holidayPay: 2_000, totalWithExtra: 6_000 });
  });

  it("by client and contract: the same figures for the contract's people, and the total equals the by-employee total", async () => {
    const w = await world();
    const e = await w.person("ByClient");
    await w.shift(e.id, "2051-03-06T08:00", "2051-03-06T18:00");
    const run = await runPayroll(w.payroll, (await periodOf(w.org, w.payroll, 2051, 3)).id);
    await w.extra(run.id, e.id, "SICK_DAY", "3000");
    const byClient = (await buildReport(w.payroll, "hourly-by-client", { from: "2051-03-01", to: "2051-03-31", clientId: w.client.id }))!;
    expect(byClient.rows).toHaveLength(1);
    expect(byClient.rows[0]).toMatchObject({ totalAmount: 10_000, leavePay: 1_000, sickPay: 3_000, holidayPay: 0, totalWithExtra: 14_000 });
    expect(byClient.totals).toMatchObject({ leavePay: 1_000, sickPay: 3_000, holidayPay: 0, totalWithExtra: 14_000 });
    const byEmp = (await buildReport(w.payroll, "hourly-summary", { from: "2051-03-01", to: "2051-03-31", clientId: w.client.id }))!;
    expect(byEmp.rows.reduce((n, x) => n + Number(x.totalWithExtra), 0)).toBe(14_000);
  });

  it("month by month: the extra pays sit in the month of the payroll, with the payroll's state; a month with hours but no calculated payroll shows 0 and is named", async () => {
    const w = await world();
    const e = await w.person("Monthly");
    await w.shift(e.id, "2051-03-06T08:00", "2051-03-06T18:00");
    await w.shift(e.id, "2051-04-03T08:00", "2051-04-03T18:00"); // April: approved hours, payroll not calculated
    const run = await runPayroll(w.payroll, (await periodOf(w.org, w.payroll, 2051, 3)).id);
    await w.extra(run.id, e.id, "SICK_DAY", "3000");
    const r = (await buildReport(w.payroll, "hourly-monthly", { from: "2051-03-01", to: "2051-04-30", clientId: w.client.id }))!;
    const mar = rowOf(r.rows, "month", "2051-03")!;
    const apr = rowOf(r.rows, "month", "2051-04")!;
    expect(mar).toMatchObject({ totalAmount: 10_000, leavePay: 1_000, sickPay: 3_000, holidayPay: 0, totalWithExtra: 14_000, payrollState: "Calculated" });
    expect(apr).toMatchObject({ totalAmount: 10_000, leavePay: 0, sickPay: 0, holidayPay: 0, totalWithExtra: 10_000, payrollState: "Not calculated" });
    expect(r.description).toMatch(/not yet calculated.*2051-04/i);
    expect(r.description).not.toMatch(/not yet calculated.*2051-03/i);
    expect(r.totals).toMatchObject({ leavePay: 1_000, sickPay: 3_000, totalWithExtra: 24_000 });
  });

  it("a supplementary payroll's extra pay counts once, and calculating the regular payroll again does not add to it", async () => {
    const w = await world();
    const e = await w.person("Supp");
    await w.shift(e.id, "2051-02-13T08:00", "2051-02-13T16:00"); // 8,000 + 800 leave pay in the regular payroll
    const period = await periodOf(w.org, w.payroll, 2051, 2);
    await runPayroll(w.payroll, period.id);
    await db.payrollPeriod.update({ where: { id: period.id }, data: { status: "LOCKED" } });
    await w.shift(e.id, "2051-02-20T08:00", "2051-02-20T13:00"); // approved after the lock: 5,000 + 500 leave pay
    await createSupplementaryRun(w.payroll, period.id, "Late hours");
    const r = (await buildReport(w.payroll, "hourly-summary", { from: "2051-02-01", to: "2051-02-28", employeeId: e.id }))!;
    expect(r.rows[0]).toMatchObject({ totalAmount: 13_000, leavePay: 1_300, totalWithExtra: 14_300 });
    const again = (await buildReport(w.payroll, "hourly-summary", { from: "2051-02-01", to: "2051-02-28", employeeId: e.id }))!;
    expect(again.rows[0]).toMatchObject({ leavePay: 1_300 });
  });

  it("a superseded run is ignored, and another company sees none of it", async () => {
    const w = await world();
    const e = await w.person("Super");
    await w.shift(e.id, "2051-01-02T08:00", "2051-01-02T18:00");
    const run = await runPayroll(w.payroll, (await periodOf(w.org, w.payroll, 2051, 1)).id);
    const before = (await buildReport(w.payroll, "hourly-summary", { from: "2051-01-01", to: "2051-01-31", employeeId: e.id }))!;
    expect(before.rows[0]).toMatchObject({ leavePay: 1_000 });
    await db.payrollRun.update({ where: { id: run.id }, data: { status: "SUPERSEDED" } });
    const after = (await buildReport(w.payroll, "hourly-summary", { from: "2051-01-01", to: "2051-01-31", employeeId: e.id }))!;
    expect(after.rows[0]).toMatchObject({ totalAmount: 10_000, leavePay: 0, totalWithExtra: 10_000 }); // the hours stay, the superseded run's extra pay does not
    const other = await isolatedOrg();
    await db.hourlyPaySetting.create({ data: { organizationId: other.org.id, enabled: true, changedBy: "t", changedByUserId: "t" } });
    for (const type of ["hourly-summary", "hourly-by-client", "hourly-monthly"] as const) {
      const r = (await buildReport(other.ctx("PAYROLL_ADMIN"), type, { from: "2051-01-01", to: "2051-03-31" }))!;
      expect(r.rows.filter((x) => Number(x.totalWithExtra ?? 0) !== 0), type).toEqual([]);
    }
  });
});
