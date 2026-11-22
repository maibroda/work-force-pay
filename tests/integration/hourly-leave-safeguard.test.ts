import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { num } from "@/lib/money";
import { payableSegments } from "@/lib/payroll/time-entry";
import { DEFAULT_EARNINGS } from "@/lib/payroll/structure";
import { createEmployee } from "@/server/services/employees";
import { leaveNotPaidNotice } from "@/server/services/leave";
import { createPeriod, runPayroll } from "@/server/services/payroll";
import { createStructure } from "@/server/services/structures";
import { ctxFor, isolatedOrg, uid } from "../helpers";

/**
 * Hourly pay, H14 piece 0 (docs/plans/hourly-payroll-h14-build-plan.md): approved annual leave for a person paid by the hour is not paid (hourly pay is for approved hours only), and nothing said so. The safeguard:
 * the payroll shows a WARNING for such a person, and whoever asks for or approves the leave is told. It changes no amount. Real payroll in the demo company for March 2042 (no other test uses it); the leave and
 * the hourly facts are put in directly. Rates are INVENTED: role weekday 1,000 an hour. Calendar: 2042-03-03 is a Monday.
 */
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const wat = (s: string) => new Date(`${s}:00+01:00`);

async function world(tag = uid()) {
  const hr = await ctxFor("HR_ADMIN");
  const payroll = await ctxFor("PAYROLL_ADMIN");
  const org = payroll.orgId;
  const cat = await db.employeeCategory.findFirstOrThrow({ where: { organizationId: org, code: "GUARD" } });
  const structure = await createStructure(payroll, {
    code: `HL-${tag}`, name: `Hourly leave ${tag}`, effectiveFrom: "2040-01-01", activate: true,
    components: DEFAULT_EARNINGS.map((c, i) => ({ code: c.code, name: c.name, calcType: "PERCENTAGE" as const, percentage: [10, 14, 15, 5, 15, 20, 2.5, 5, 13.5][i], taxable: true, pensionable: c.pensionable })),
  });
  const client = await db.client.create({ data: { organizationId: org, code: `LV${tag}`, name: `Leave Client ${tag}` } });
  const contract = await db.contract.create({ data: { organizationId: org, clientId: client.id, contractNumber: `LK${tag}`, name: `Leave guarding ${tag}`, startDate: day("2040-01-01") } });
  const beat = await db.beat.create({ data: { organizationId: org, clientId: client.id, contractId: contract.id, code: `LB${tag}`, name: `Leave site ${tag}`, state: "Lagos" } });
  await db.contractRate.create({ data: { organizationId: org, contractId: contract.id, categoryId: cat.id, salaryStructureId: structure.id, agreedRate: "200000", effectiveFrom: day("2040-01-01") } });
  if (!(await db.hourlyRate.findFirst({ where: { organizationId: org, scope: "CATEGORY", categoryId: cat.id, status: "APPROVED", effectiveTo: null } })))
    await db.hourlyRate.create({ data: { organizationId: org, scope: "CATEGORY", categoryId: cat.id, weekdayRate: "1000", weekendRate: "1500", holidayRate: "2000", effectiveFrom: day("2030-01-01"), reason: "test", status: "APPROVED", proposedBy: "t", proposedByUserId: "t", decidedBy: "t2", decidedByUserId: "t2" } });
  let n = 0;
  const person = async (label: string, hourly = true) => {
    n += 1;
    const e = await createEmployee(hr, { firstName: "Lv", lastName: `${label}${tag}`, employmentDate: "2040-01-01", categoryId: cat.id, bankName: "GTBank", accountNumber: `74${String(Date.now()).slice(-7)}${n}`, accountName: `LV ${label}` } as never);
    if (hourly) await db.employeeCompensationType.create({ data: { organizationId: org, employeeId: e.id, type: "HOURLY", effectiveFrom: day("2040-01-01"), reason: "test", status: "APPROVED", proposedBy: "t", proposedByUserId: "t", decidedBy: "t", decidedByUserId: "t2" } });
    return e;
  };
  const shift = async (employeeId: string, from: string, to: string) => {
    const cin = wat(from);
    const cout = wat(to);
    const en = await db.timeEntry.create({ data: { organizationId: org, employeeId, clientId: client.id, contractId: contract.id, beatId: beat.id, clockIn: cin, clockOut: cout, status: "APPROVED", capturedBy: "cap", capturedByUserId: "cap-user", decidedBy: "dec", decidedByUserId: "dec-user", decidedAt: new Date(), placeState: "Lagos", calendarConfirmed: true, payableMinutes: (cout.getTime() - cin.getTime()) / 60000 } });
    await db.timeEntrySegment.createMany({ data: payableSegments(cin, cout, [], new Set()).map((s) => ({ organizationId: org, entryId: en.id, date: day(s.date), dayClass: s.dayClass, minutes: s.minutes })) });
  };
  const leave = (employeeId: string, from: string, to: string, over: { unpaid?: boolean; status?: "APPROVED" | "PENDING" } = {}) =>
    db.leaveRequest.create({ data: { organizationId: org, employeeId, cycleStart: day("2042-01-01"), cycleEnd: day("2042-12-31"), startDate: day(from), endDate: day(to), workingDays: 5, unpaid: over.unpaid ?? false, status: over.status ?? "APPROVED", requestedBy: "t", decidedBy: "t", decidedById: "t" } });
  const found = (runId: string, employeeId: string) => db.payrollValidationIssue.findMany({ where: { runId, employeeId, code: "HOURLY_LEAVE_NOT_PAID" } });
  return { hr, payroll, org, person, shift, leave, found };
}

describe("the payroll warns about approved annual leave for a person paid by the hour", () => {
  it("warns (a warning only), names the days and says they are not paid, and the pay is exactly what the hours earned", async () => {
    const w = await world();
    const e = await w.person("Hours");
    await w.shift(e.id, "2042-03-04T08:00", "2042-03-04T16:00"); // 8 h on Tuesday 4 March = 8,000
    await w.leave(e.id, "2042-03-10", "2042-03-12"); // Monday to Wednesday: 3 working days of approved annual leave
    const period = await createPeriod(w.payroll, 2042, 3);
    const run = await runPayroll(w.payroll, period.id);
    const found = await w.found(run.id, e.id);
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("WARNING");
    expect(found[0].requiresExplanation).toBe(false);
    expect(found[0].message).toContain("3 approved annual leave day(s)");
    expect(found[0].message).toContain("2042-03-10");
    expect(found[0].message).toMatch(/not paid/i);
    const rec = await db.payrollRecord.findFirstOrThrow({ where: { runId: run.id, employeeId: e.id } });
    expect(Math.abs(num(rec.earnedGross) - 8_000)).toBeLessThan(0.06); // no amount changes: the hours only
    expect(await db.payrollValidationIssue.count({ where: { runId: run.id, employeeId: e.id, severity: "CRITICAL" } })).toBe(0);
  });

  it("warns a person with approved leave and no hours at all in the month (they have no payroll record, so the warning is how anyone finds out)", async () => {
    const w = await world();
    const e = await w.person("NoHours");
    await w.leave(e.id, "2042-03-17", "2042-03-18");
    const period = await db.payrollPeriod.findFirstOrThrow({ where: { organizationId: w.org, year: 2042, month: 3 } });
    const run = await runPayroll(w.payroll, period.id);
    expect(await w.found(run.id, e.id)).toHaveLength(1);
    expect(await db.payrollRecord.count({ where: { runId: run.id, employeeId: e.id } })).toBe(0);
  });

  it("does not warn about a person paid monthly, unpaid leave, leave not approved, or leave in another month", async () => {
    const w = await world();
    const monthly = await w.person("Monthly", false);
    const unpaid = await w.person("Unpaid");
    const pending = await w.person("Pending");
    const other = await w.person("Other");
    await w.leave(monthly.id, "2042-03-10", "2042-03-12");
    await w.leave(unpaid.id, "2042-03-10", "2042-03-12", { unpaid: true });
    await w.leave(pending.id, "2042-03-10", "2042-03-12", { status: "PENDING" });
    await w.leave(other.id, "2042-04-07", "2042-04-08"); // April
    const period = await db.payrollPeriod.findFirstOrThrow({ where: { organizationId: w.org, year: 2042, month: 3 } });
    const run = await runPayroll(w.payroll, period.id);
    for (const p of [monthly, unpaid, pending, other]) expect(await w.found(run.id, p.id), p.lastName).toHaveLength(0);
  });
});

describe("the notice shown when annual leave is asked for or approved", () => {
  it("tells whoever is asking or approving that the days a person paid by the hour takes are not paid, and says nothing for a person paid monthly", async () => {
    const w = await world();
    const hourly = await w.person("NoticeHourly");
    const monthly = await w.person("NoticeMonthly", false);
    const note = await leaveNotPaidNotice(w.hr, hourly.id, "2042-03-10", "2042-03-14");
    expect(note).toMatch(/paid by the hour on 5 of these leave day\(s\)/);
    expect(note).toMatch(/not paid/i);
    expect(await leaveNotPaidNotice(w.hr, monthly.id, "2042-03-10", "2042-03-14")).toBeNull();
  });

  it("another company's person is not found: no notice, nothing about them", async () => {
    const w = await world();
    const hourly = await w.person("NoticeOther");
    const other = await isolatedOrg();
    expect(await leaveNotPaidNotice(other.ctx("HR_ADMIN"), hourly.id, "2042-03-10", "2042-03-14")).toBeNull();
  });
});
