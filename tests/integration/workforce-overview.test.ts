import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { can, type Role } from "@/lib/auth/permissions";
import { iso } from "@/lib/dates";
import { createEmployee } from "@/server/services/employees";
import { todayUtc } from "@/server/services/hr-policy";
import { workforceOverview } from "@/server/services/workforce-overview";
import { isolatedOrg, uid } from "../helpers";

// The Workforce overview (Analytics > Workforce overview): headcount by deployment site and role, tenure, contract type, people managers and average monthly gross pay from a
// payroll run. Read-only; needs analytics.view (as Workforce cost does). Any average of pay is shown only for at least five people with a pay figure. No name and no individual
// pay figure ever leaves the service.

const ago = (years: number, extraDays = 0) => {
  const t = todayUtc();
  return iso(new Date(Date.UTC(t.getUTCFullYear() - years, t.getUTCMonth(), t.getUTCDate() - extraDays)));
};
const ZERO = "0";
const record = (orgId: string, runId: string, emp: { id: string; employeeNumber: string }, gross: string) => ({
  organizationId: orgId,
  runId,
  employeeId: emp.id,
  employeeNumber: emp.employeeNumber,
  employeeName: "Not used",
  categoryName: "Not used",
  basisDays: 26,
  daysWorked: "26",
  monthlyGross: gross,
  earnedGross: gross,
  totalEarnings: gross,
  pensionBase: ZERO,
  employeePension: ZERO,
  employerPension: ZERO,
  taxableIncome: ZERO,
  paye: ZERO,
  totalDeductions: ZERO,
  netPay: gross,
  employerCost: gross,
  taxRuleVersion: "test",
  lines: [],
  locations: [],
});

async function world(withPay = true) {
  const t = await isolatedOrg();
  const hr = t.ctx("HR_ADMIN");
  const analyst = t.ctx("COMPANY_ADMIN");
  const mk = async (firstName: string, categoryId: string, employmentDate: string, extra: Record<string, unknown> = {}) =>
    createEmployee(hr, { firstName, lastName: "Zzperson", employmentDate, categoryId, ...extra } as never);

  const siteA = await db.client.create({ data: { organizationId: t.org.id, code: "SA", name: "Alpha Plaza" } });
  const siteB = await db.client.create({ data: { organizationId: t.org.id, code: "SB", name: "Bravo Mall" } });

  // six guards: five at Alpha Plaza, one at Bravo Mall; two office staff who are not deployed
  const guards = [];
  const years = [0, 1, 2, 4, 7, 12];
  for (let i = 0; i < 6; i++) guards.push(await mk(`Guard${i}`, t.guardId, ago(years[i], i === 0 ? 30 : 5), { departmentId: t.deptId }));
  const office = [await mk("Office0", t.officeId, ago(3, 2)), await mk("Office1", t.officeId, ago(0, 100))];
  for (const g of guards.slice(0, 5)) await db.employee.update({ where: { id: g.id }, data: { currentClientId: siteA.id } });
  await db.employee.update({ where: { id: guards[5].id }, data: { currentClientId: siteB.id } });
  // the first office person is the reporting manager of two guards
  await db.employee.update({ where: { id: guards[0].id }, data: { reportingManagerId: office[0].id } });
  await db.employee.update({ where: { id: guards[1].id }, data: { reportingManagerId: office[0].id } });
  // contract types: five permanent guards, one fixed-term guard, the office staff on probation
  const contract = (emp: { id: string }, type: "PERMANENT" | "FIXED_TERM" | "PROBATION") =>
    db.employmentContract.create({ data: { organizationId: t.org.id, contractNumber: `C-${uid()}${uid()}`, employeeId: emp.id, type, jobTitle: "Role", createdBy: "test", startDate: new Date(`${ago(1)}T00:00:00Z`) } });
  for (const g of guards.slice(0, 5)) await contract(g, "PERMANENT");
  await contract(guards[5], "FIXED_TERM");
  for (const o of office) await contract(o, "PROBATION");
  // people who are not counted: an exited employee, and one on leave who IS counted
  await mk("Gone", t.guardId, ago(2), { status: "EXITED" });
  const onLeave = await mk("Leave", t.guardId, ago(2, 40), { status: "ON_LEAVE" });
  await db.employee.update({ where: { id: onLeave.id }, data: { currentClientId: siteA.id } });
  await contract(onLeave, "PERMANENT");

  let runId: string | null = null;
  if (withPay) {
    const t0 = todayUtc();
    const period = await db.payrollPeriod.create({ data: { organizationId: t.org.id, name: "Test month", year: t0.getUTCFullYear(), month: t0.getUTCMonth() + 1, startDate: new Date(Date.UTC(t0.getUTCFullYear(), t0.getUTCMonth(), 1)), endDate: new Date(Date.UTC(t0.getUTCFullYear(), t0.getUTCMonth() + 1, 0)) } });
    const run = await db.payrollRun.create({ data: { organizationId: t.org.id, periodId: period.id, runNumber: 1 } });
    runId = run.id;
    // five guards at Alpha Plaza at 100,000.00; the guard at Bravo Mall 150,000.50; the on-leave guard 100,000.00; two office staff 200,000.00
    const rows = [...guards.slice(0, 5).map((g) => record(t.org.id, run.id, g, "100000.00")), record(t.org.id, run.id, guards[5], "150000.50"), record(t.org.id, run.id, onLeave, "100000.00"), ...office.map((o) => record(t.org.id, run.id, o, "200000.00"))];
    await db.payrollRecord.createMany({ data: rows });
  }
  return { t, hr, analyst, guards, office, siteA, siteB, runId };
}

describe("who may open it", () => {
  it("needs analytics.view, exactly as the other analytics pages do: every role without it is refused", async () => {
    const w = await world(false);
    const roles: Role[] = ["SUPER_ADMIN", "COMPANY_ADMIN", "HR_ADMIN", "HR_OFFICER", "OPERATIONS", "PAYROLL_ADMIN", "FINANCE", "AUDITOR", "SUPERVISOR", "EMPLOYEE", "CLIENT_APPROVER", "CLIENT_HR", "SALES_REP"];
    for (const r of roles) {
      const ctx = w.t.ctx(r);
      if (can(r, "analytics.view")) await expect(workforceOverview(ctx, {}), r).resolves.toBeTruthy();
      else await expect(workforceOverview(ctx, {}), r).rejects.toThrow(/permission/);
    }
  });
});

describe("the figures", () => {
  it("counts active and on-leave employees only, and never an exited one", async () => {
    const w = await world();
    const o = await workforceOverview(w.analyst, {});
    expect(o.headcount).toBe(9); // 6 guards + 2 office + 1 on leave; the exited one is not counted
  });

  it("splits headcount by deployment site, with those not deployed apart, and by role, as shares that add up", async () => {
    const w = await world();
    const o = await workforceOverview(w.analyst, {});
    expect(Object.fromEntries(o.bySite.map((s) => [s.name, s.count]))).toEqual({ "Alpha Plaza": 6, "Bravo Mall": 1, "Not deployed": 2 });
    expect(Object.fromEntries(o.byRole.map((r) => [r.name, r.count]))).toEqual({ "Security Guard": 7, "Office Staff": 2 });
    expect(o.bySite.reduce((a, s) => a + s.count, 0)).toBe(o.headcount);
    expect(o.byRole.reduce((a, r) => a + r.count, 0)).toBe(o.headcount);
    expect(o.bySite[0].name).toBe("Alpha Plaza"); // largest first
    expect(o.bySite.find((s) => s.name === "Alpha Plaza")!.share).toBe(67); // 6 of 9
  });

  it("bands tenure and averages it to one decimal", async () => {
    const w = await world();
    const o = await workforceOverview(w.analyst, {});
    expect(o.tenure.map((b) => b.band)).toEqual(["<1", "1–3", "3–5", "5–10", "10+"]);
    expect(o.tenure.reduce((a, b) => a + b.count, 0)).toBe(o.headcount);
    expect(Object.fromEntries(o.tenure.map((b) => [b.band, b.count]))).toEqual({ "<1": 2, "1–3": 3, "3–5": 2, "5–10": 1, "10+": 1 });
    expect(typeof o.averageTenureYears).toBe("number");
  });

  it("counts contract types", async () => {
    const w = await world();
    const o = await workforceOverview(w.analyst, {});
    expect(Object.fromEntries(o.contractTypes.map((c) => [c.type, c.count]))).toEqual({ PERMANENT: 6, FIXED_TERM: 1, PROBATION: 2 });
    const bare = await workforceOverview(w.analyst, { siteId: "none", categoryId: w.t.guardId });
    expect(bare.headcount).toBe(0);
  });

  it("counts people managers as those who have direct reports, to one decimal", async () => {
    const w = await world();
    const o = await workforceOverview(w.analyst, {});
    expect(o.peopleManagers.count).toBe(1);
    expect(o.peopleManagers.percent).toBe(11.1); // 1 of 9
  });
});

describe("pay figures", () => {
  it("averages monthly gross from the latest run in whole kobo, rounded half up once", async () => {
    const w = await world();
    const o = await workforceOverview(w.analyst, {});
    expect(o.payRun).not.toBeNull();
    // (5 x 10,000,000 + 15,000,050 + 10,000,000 + 2 x 20,000,000) / 9 kobo = 115,000,050 / 9 = 12,777,783.33
    expect(o.averageGross).toEqual({ kobo: 12_777_783, reason: "SHOWN" });
  });

  it("shows an average only for at least five people with a pay figure: a smaller group is hidden, never shown as one person's pay", async () => {
    const w = await world();
    const o = await workforceOverview(w.analyst, {});
    const role = (n: string) => o.byRole.find((r) => r.name === n)!;
    // 7 guards with a figure: (5 x 10,000,000 + 15,000,050 + 10,000,000) / 7 = 10,714,292.86 kobo
    expect(role("Security Guard").averageGross).toEqual({ kobo: 10_714_293, reason: "SHOWN" });
    expect(role("Office Staff").averageGross).toEqual({ kobo: null, reason: "SMALL_GROUP" });
    const site = (n: string) => o.siteTable.find((s) => s.name === n)!;
    expect(site("Alpha Plaza").averageGross.reason).toBe("SHOWN");
    expect(site("Bravo Mall").averageGross).toEqual({ kobo: null, reason: "SMALL_GROUP" });
    expect(site("Not deployed").averageGross).toEqual({ kobo: null, reason: "SMALL_GROUP" });
    expect(site("Bravo Mall").vsCompany).toBeNull();
    const narrowed = await workforceOverview(w.analyst, { categoryId: w.t.officeId });
    expect(narrowed.headcount).toBe(2);
    expect(narrowed.averageGross).toEqual({ kobo: null, reason: "SMALL_GROUP" });
  });

  it("compares a shown group with the company as a whole percent", async () => {
    const w = await world();
    const o = await workforceOverview(w.analyst, {});
    const alpha = o.siteTable.find((s) => s.name === "Alpha Plaza")!;
    // Alpha Plaza: 6 people at 10,000,000 kobo; the company average is 12,777,783 kobo: -21.7% rounds to -22
    expect(alpha.averageGross.kobo).toBe(10_000_000);
    expect(alpha.vsCompany).toBe(-22);
  });

  it("says so, and shows no pay figure, when the company has no payroll run", async () => {
    const w = await world(false);
    const o = await workforceOverview(w.analyst, {});
    expect(o.payRun).toBeNull();
    expect(o.averageGross).toEqual({ kobo: null, reason: "NO_PAYROLL" });
    expect(o.headcount).toBe(9); // headcount does not need pay
  });
});

describe("filters", () => {
  it("narrow every figure by site, role, department and contract type", async () => {
    const w = await world();
    const alpha = await workforceOverview(w.analyst, { siteId: w.siteA.id });
    expect(alpha.headcount).toBe(6);
    const office = await workforceOverview(w.analyst, { categoryId: w.t.officeId });
    expect(office.headcount).toBe(2);
    const dept = await workforceOverview(w.analyst, { departmentId: w.t.deptId });
    expect(dept.headcount).toBe(6); // the six guards with the department (the on-leave guard has none)
    const fixed = await workforceOverview(w.analyst, { contractType: "FIXED_TERM" });
    expect(fixed.headcount).toBe(1);
    const none = await workforceOverview(w.analyst, { siteId: "none" });
    expect(none.headcount).toBe(2);
    expect(none.bySite.map((s) => s.name)).toEqual(["Not deployed"]);
  });
  it("offers only this company's sites, roles and departments", async () => {
    const w = await world();
    const other = await world();
    const o = await workforceOverview(w.analyst, {});
    expect(o.options.sites.map((s) => s.id)).toContain(w.siteA.id);
    expect(o.options.sites.map((s) => s.id)).not.toContain(other.siteA.id);
    expect(o.options.roles.map((r) => r.id).sort()).toEqual([w.t.guardId, w.t.officeId].sort());
  });
});

describe("what never leaves the service", () => {
  it("holds no name and no individual pay figure", async () => {
    const w = await world();
    const text = JSON.stringify(await workforceOverview(w.analyst, {}));
    expect(text).not.toMatch(/Zzperson|Guard0|Office0|employeeNumber|monthlyGross|accountNumber/);
  });
});

describe("tenant isolation", () => {
  it("counts only the caller's company, and ignores another company's payroll run id", async () => {
    const w = await world();
    const other = await world();
    const mine = await workforceOverview(w.analyst, {});
    const theirs = await workforceOverview(other.analyst, {});
    expect(mine.headcount).toBe(9);
    expect(theirs.headcount).toBe(9);
    const crossed = await workforceOverview(w.analyst, { runId: other.runId! });
    expect(crossed.payRun).toBeNull(); // not found in this company: no pay figures, no error that confirms it exists
    expect(crossed.averageGross.reason).toBe("NO_PAYROLL");
    expect(crossed.headcount).toBe(9);
  });
});
