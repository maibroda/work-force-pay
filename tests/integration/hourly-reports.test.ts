import { describe, expect, it } from "vitest";
import { reportPermission } from "@/lib/report-access";
import { db } from "@/lib/db";
import { buildReport, REPORT_TYPES } from "@/server/report-registry";
import { createEmployee } from "@/server/services/employees";
import { toCsv } from "@/server/services/reports";
import { approveTimeEntry, captureTimeEntry, correctTimeEntry, submitTimeEntry } from "@/server/services/time-entries";
import { isolatedOrg, uid } from "../helpers";

/**
 * Hourly pay, phase 5 (docs/plans/hourly-payroll-assessment.md): the hourly reports, read from APPROVED time entries and APPROVED hourly rates. The cost is INDICATIVE (approved hours x approved rates), not
 * payroll. Rates are INVENTED for the tests: role weekday 1,000, weekend 1,500, holiday 2,000; one person's own 1,200, 1,800, 2,400. Calendar: 2026-11-20 is a Friday, 21 a Saturday, 22 a Sunday.
 */
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

async function world() {
  const t = await isolatedOrg();
  await db.hourlyPaySetting.create({ data: { organizationId: t.org.id, enabled: true, changedBy: "test", changedByUserId: "test" } });
  const sup = t.ctx("SUPERVISOR", null, 1);
  await db.user.create({ data: { id: sup.userId, organizationId: t.org.id, email: sup.email, name: sup.name, passwordHash: "x", role: "SUPERVISOR" } });
  const ops = t.ctx("OPERATIONS", null, 1);
  const payroll = t.ctx("PAYROLL_ADMIN", null, 1);
  const admin = t.ctx("COMPANY_ADMIN", null, 1);
  const hr = t.ctx("HR_ADMIN");
  const mk = async (name: string) => {
    const client = await db.client.create({ data: { organizationId: t.org.id, code: `C${uid()}`, name } });
    const contract = await db.contract.create({ data: { organizationId: t.org.id, clientId: client.id, contractNumber: `K${uid()}`, name: `${name} guarding`, startDate: day("2026-01-01") } });
    const beat = await db.beat.create({ data: { organizationId: t.org.id, clientId: client.id, contractId: contract.id, code: `B${uid()}`, name: `${name} site`, state: "Lagos", supervisorId: sup.userId } });
    return { client, contract, beat };
  };
  const one = await mk("Alpha Bank");
  const two = await mk("Beta Foods");
  const hourly = async (n: string, categoryId = t.guardId) => {
    const e = await createEmployee(hr, { firstName: "Hourly", lastName: n, employmentDate: "2026-01-01", categoryId } as never);
    await db.employeeCompensationType.create({ data: { organizationId: t.org.id, employeeId: e.id, type: "HOURLY", effectiveFrom: day("2026-01-01"), reason: "test", status: "APPROVED", proposedBy: "t", proposedByUserId: "t", decidedBy: "t", decidedByUserId: "t2" } });
    return e;
  };
  const rate = (over: Record<string, unknown>) => db.hourlyRate.create({ data: { organizationId: t.org.id, weekdayRate: "1000", weekendRate: "1500", holidayRate: "2000", effectiveFrom: day("2026-01-01"), reason: "test", status: "APPROVED", proposedBy: "t", proposedByUserId: "t", decidedBy: "t2", decidedByUserId: "t2", scope: "CATEGORY", categoryId: t.guardId, ...over } as never });
  await rate({});
  const e1 = await hourly("One");
  const e2 = await hourly("Two");
  const e3 = await hourly("Three");
  const e4 = await hourly("Four", t.officeId); // a job role with no hourly rate
  await rate({ scope: "EMPLOYEE", employeeId: e2.id, categoryId: null, weekdayRate: "1200", weekendRate: "1800", holidayRate: "2400" });
  const capture = (employeeId: string, beatId: string, from: string, to: string | null) => captureTimeEntry(ops, { employeeId, beatId, clockIn: from, clockOut: to });
  const approved = async (employeeId: string, beatId: string, from: string, to: string, breaks = "") => {
    const e = await capture(employeeId, beatId, from, to);
    await submitTimeEntry(ops, e.id);
    return approveTimeEntry(sup, e.id, { breaks });
  };
  const hol = await db.publicHoliday.create({ data: { organizationId: t.org.id, date: day("2026-11-21"), name: "A Lagos holiday", createdBy: "t" } });
  await db.publicHolidayState.create({ data: { organizationId: t.org.id, holidayId: hol.id, state: "Lagos", createdBy: "t" } });
  return { t, sup, ops, payroll, admin, hr, one, two, e1, e2, e3, e4, capture, approved };
}

/** The scenario every report is checked against. */
async function scenario() {
  const w = await world();
  await w.approved(w.e1.id, w.one.beat.id, "2026-11-20T19:00", "2026-11-21T07:00", "02:00-02:30"); // Fri 5 h weekday, Sat 6.5 h holiday (Lagos): 5,000 + 13,000
  await w.approved(w.e2.id, w.two.beat.id, "2026-11-22T08:00", "2026-11-22T16:00"); // Sun 8 h weekend at the person's own 1,800: 14,400
  const waiting = await w.capture(w.e1.id, w.one.beat.id, "2026-11-23T08:00", "2026-11-23T16:00");
  await submitTimeEntry(w.ops, waiting.id); // submitted, not approved: 8 h waiting
  await w.capture(w.e1.id, w.one.beat.id, "2026-11-24T08:00", null); // a draft with no clock-out
  await w.approved(w.e4.id, w.one.beat.id, "2026-11-25T08:00", "2026-11-25T16:00"); // 8 h with no hourly rate for the role
  await w.approved(w.e3.id, w.one.beat.id, "2026-07-31T19:00", "2026-08-01T07:00"); // over a month end: July 5 h weekday (5,000), August 7 h weekend (10,500)
  return w;
}
const NOV = { from: "2026-11-01", to: "2026-11-30" };
const col = (rows: Array<Record<string, unknown>>, key: string) => rows.map((r) => r[key]);

describe("who may open the hourly reports", () => {
  it("the cost reports need the payroll right and the hours-only report needs only the reports right", () => {
    expect(reportPermission("hourly-summary")).toBe("payroll.view");
    expect(reportPermission("hourly-by-client")).toBe("payroll.view");
    expect(reportPermission("hourly-monthly")).toBe("payroll.view");
    expect(reportPermission("hourly-status")).toBe("reports.view");
    for (const r of ["hourly-summary", "hourly-by-client", "hourly-monthly", "hourly-status"]) expect(REPORT_TYPES as readonly string[]).toContain(r);
  });

  it("with hourly pay switched off every hourly report is empty and says why", async () => {
    const w = await scenario();
    await db.hourlyPaySetting.update({ where: { organizationId: w.t.org.id }, data: { enabled: false } });
    for (const type of ["hourly-summary", "hourly-by-client", "hourly-monthly", "hourly-status"] as const) {
      const r = await buildReport(w.payroll, type, NOV);
      expect(r?.rows, type).toEqual([]);
      expect(r?.description, type).toMatch(/not switched on/i);
    }
  });
});

describe("hourly-summary: approved hours and the indicative cost by employee", () => {
  it("shows each person's hours and cost by class, from approved shifts only, at the approved rates", async () => {
    const w = await scenario();
    const r = (await buildReport(w.payroll, "hourly-summary", NOV))!;
    expect(r.rows.map((x) => [x.employeeName, x.weekdayHours, x.weekendHours, x.holidayHours, x.totalHours, x.weekdayAmount, x.weekendAmount, x.holidayAmount, x.totalAmount, x.unpricedHours])).toEqual([
      ["Hourly One", 5, 0, 6.5, 11.5, 5000, 0, 13000, 18000, 0], // the Lagos holiday on the Saturday, the break taken off (390 minutes, not 420)
      ["Hourly Two", 0, 8, 0, 8, 0, 14400, 0, 14400, 0], // the person's own rate wins over the role's
      ["Hourly Four", 8, 0, 0, 8, 0, 0, 0, 0, 8], // hours with no approved rate are kept apart, never priced as zero
    ]);
    expect(r.totals).toMatchObject({ totalHours: 27.5, totalAmount: 32400, unpricedHours: 8 });
    expect(r.description).toMatch(/indicative/i);
  });

  it("leaves out a shift that was only submitted and a draft with no clock-out, and counts nothing outside the dates asked for", async () => {
    const w = await scenario();
    const r = (await buildReport(w.payroll, "hourly-summary", { from: "2026-11-23", to: "2026-11-30" }))!;
    expect(col(r.rows, "employeeName")).toEqual(["Hourly Four"]); // only the approved shift of 25 November in that range
    const july = (await buildReport(w.payroll, "hourly-summary", { from: "2026-07-01", to: "2026-07-31" }))!;
    expect(july.rows.map((x) => [x.employeeName, x.totalHours, x.totalAmount])).toEqual([["Hourly Three", 5, 5000]]);
  });

  it("filters by client and by employee", async () => {
    const w = await scenario();
    const beta = (await buildReport(w.payroll, "hourly-summary", { ...NOV, clientId: w.two.client.id }))!;
    expect(col(beta.rows, "employeeName")).toEqual(["Hourly Two"]);
    const alpha = (await buildReport(w.payroll, "hourly-summary", { ...NOV, clientId: w.one.client.id }))!;
    expect(col(alpha.rows, "employeeName")).toEqual(["Hourly One", "Hourly Four"]);
    const only = (await buildReport(w.payroll, "hourly-summary", { ...NOV, employeeId: w.e2.id }))!;
    expect(col(only.rows, "employeeName")).toEqual(["Hourly Two"]);
  });

  it("a rate that changes in the middle of the month prices each day at the rate in force that day", async () => {
    const w = await world();
    await db.hourlyRate.updateMany({ where: { organizationId: w.t.org.id, scope: "CATEGORY" }, data: { effectiveTo: day("2026-11-15") } });
    await db.hourlyRate.create({ data: { organizationId: w.t.org.id, scope: "CATEGORY", categoryId: w.t.guardId, weekdayRate: "1200", weekendRate: "1700", holidayRate: "2200", effectiveFrom: day("2026-11-16"), reason: "test", status: "APPROVED", proposedBy: "t", proposedByUserId: "t", decidedBy: "t2", decidedByUserId: "t2" } });
    await w.approved(w.e1.id, w.one.beat.id, "2026-11-13T08:00", "2026-11-13T16:00"); // Friday 13th: 8 h at 1,000
    await w.approved(w.e1.id, w.one.beat.id, "2026-11-17T08:00", "2026-11-17T16:00"); // Tuesday 17th: 8 h at 1,200
    const r = (await buildReport(w.payroll, "hourly-summary", NOV))!;
    expect(r.rows.map((x) => [x.weekdayHours, x.weekdayAmount])).toEqual([[16, 17600]]);
  });

  it("when an approved shift is corrected, only the correction counts once it is approved", async () => {
    const w = await world();
    const orig = await w.approved(w.e2.id, w.two.beat.id, "2026-11-22T08:00", "2026-11-22T16:00"); // 8 h at 1,800
    const fix = await correctTimeEntry(w.ops, orig.id, { clockIn: "2026-11-22T08:00", clockOut: "2026-11-22T15:00", reason: "Left an hour early in fact" });
    expect((await buildReport(w.payroll, "hourly-summary", NOV))!.rows.map((x) => x.totalAmount)).toEqual([14400]); // the original still counts
    await submitTimeEntry(w.ops, fix.id);
    await approveTimeEntry(w.sup, fix.id, {});
    expect((await buildReport(w.payroll, "hourly-summary", NOV))!.rows.map((x) => [x.totalHours, x.totalAmount])).toEqual([[7, 12600]]);
  });

  it("only that company's hours: another company sees nothing", async () => {
    const a = await scenario();
    const b = await world();
    expect((await buildReport(b.payroll, "hourly-summary", NOV))!.rows).toEqual([]);
    expect((await buildReport(a.payroll, "hourly-summary", NOV))!.rows).toHaveLength(3);
  });

  it("can be downloaded as a CSV", async () => {
    const w = await scenario();
    const r = (await buildReport(w.payroll, "hourly-summary", NOV))!;
    const csv = toCsv(r.rows, r.columns);
    expect(csv.split("\n")[0]).toContain("Total hours");
    expect(csv).toContain("Hourly One");
  });
});

describe("hourly-by-client: cost by client and contract, adding up to the same total", () => {
  it("one row per client and contract, and its total is the sum of the by-employee report (nothing counted twice)", async () => {
    const w = await scenario();
    const r = (await buildReport(w.payroll, "hourly-by-client", NOV))!;
    expect(r.rows.map((x) => [x.client, x.people, x.totalHours, x.totalAmount, x.unpricedHours])).toEqual([
      ["Alpha Bank", 2, 19.5, 18000, 8],
      ["Beta Foods", 1, 8, 14400, 0],
    ]);
    const summary = (await buildReport(w.payroll, "hourly-summary", NOV))!;
    expect(r.totals).toMatchObject({ totalHours: summary.totals!.totalHours, totalAmount: summary.totals!.totalAmount, unpricedHours: summary.totals!.unpricedHours });
  });
});

describe("hourly-monthly: month by month, with the change from the month before", () => {
  it("one row for every month asked for, a shift over a month end split between the two months, and the change shown", async () => {
    const w = await scenario();
    const r = (await buildReport(w.payroll, "hourly-monthly", { from: "2026-07-01", to: "2026-11-30" }))!;
    expect(r.rows.map((x) => [x.month, x.people, x.totalHours, x.totalAmount, x.hoursChange, x.amountChange])).toEqual([
      ["2026-07", 1, 5, 5000, null, null],
      ["2026-08", 1, 7, 10500, 2, 5500],
      ["2026-09", 0, 0, 0, -7, -10500],
      ["2026-10", 0, 0, 0, 0, 0],
      ["2026-11", 3, 27.5, 32400, 27.5, 32400],
    ]);
    expect(r.totals).toMatchObject({ totalHours: 39.5, totalAmount: 47900 });
  });
});

describe("hourly-status: approved hours against hours still waiting", () => {
  it("separates approved hours, hours waiting for approval, drafts, shifts with no clock-out, and rejected or withdrawn ones", async () => {
    const w = await scenario();
    const rejected = await w.capture(w.e2.id, w.two.beat.id, "2026-11-26T08:00", "2026-11-26T16:00");
    await submitTimeEntry(w.ops, rejected.id);
    const { rejectTimeEntry } = await import("@/server/services/time-entries");
    await rejectTimeEntry(w.sup, rejected.id, "Not worked on that day");
    await w.capture(w.e2.id, w.two.beat.id, "2026-11-27T08:00", "2026-11-27T12:00"); // a complete draft, not yet submitted
    const r = (await buildReport(w.ops, "hourly-status", NOV))!;
    expect(r.rows.map((x) => [x.employeeName, x.approvedHours, x.waitingHours, x.draftHours, x.noClockOut, x.rejectedHours])).toEqual([
      ["Hourly One", 11.5, 8, 0, 1, 0],
      ["Hourly Two", 8, 0, 4, 0, 8],
      ["Hourly Four", 8, 0, 0, 0, 0],
    ]);
    expect(r.rows[0]).not.toHaveProperty("totalAmount"); // hours only: no money in the report the reports right opens
    expect(r.columns.some((c) => c.money)).toBe(false);
  });
});
