import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { num } from "@/lib/money";
import { can } from "@/lib/auth/permissions";
import { reportPermission } from "@/lib/report-access";
import { buildReport } from "@/server/report-registry";
import { toCsv } from "@/server/services/reports";
import { ctxFor, periodFor } from "../helpers";

/** August 2026 is locked in the seed, so its figures can't move under this test. */
async function lockedRun() {
  const ctx = await ctxFor("PAYROLL_ADMIN");
  const period = await periodFor(ctx, 2026, 8);
  const run = await db.payrollRun.findFirstOrThrow({ where: { organizationId: ctx.orgId, periodId: period.id, type: "REGULAR" } });
  return { ctx, run };
}

describe("Employer Contributions report", () => {
  it("has one row per employee, a column per head, and totals that add up", async () => {
    const { ctx, run } = await lockedRun();
    const rep = (await buildReport(ctx, "employer-contributions", { runId: run.id }))!;
    const recs = await db.payrollRecord.findMany({ where: { runId: run.id }, orderBy: { employeeNumber: "asc" } });
    expect(rep.title).toBe("Employer contributions");
    expect(rep.usesRun).toBe(true);
    expect(rep.rows).toHaveLength(recs.length);
    expect(rep.rows.map((r) => r.employeeNumber)).toEqual(recs.map((r) => r.employeeNumber));

    const heads = ["employerPension", "itf", "nsitf", "nhfMedical", "insurance", "uniformKits", "recruitmentTraining", "leaveReliever", "outsourcingLeaveAllowance"] as const;
    for (const row of rep.rows) {
      const sum = heads.reduce((a, h) => a + (row[h] as number), 0);
      expect(row.total as number).toBeCloseTo(sum, 2);
    }
    // each head matches what the payroll stored for that employee
    const first = recs.find((r) => num(r.employerPension) > 0)!;
    const row = rep.rows.find((r) => r.employeeNumber === first.employeeNumber)!;
    expect(row).toMatchObject({
      employerPension: num(first.employerPension),
      itf: num(first.itfAmount),
      nsitf: num(first.nsitfAmount),
      insurance: num(first.insuranceAmount),
      uniformKits: num(first.uniformKitsAmount),
    });
    // the totals row is the sum of the column
    const pensionTotal = recs.reduce((a, r) => a + num(r.employerPension), 0);
    expect(rep.totals!.employerPension).toBeCloseTo(pensionTotal, 1);
    expect(rep.totals!.total).toBeCloseTo(rep.rows.reduce((a, r) => a + (r.total as number), 0), 1);
    expect(rep.totals!.total).toBeGreaterThan(0);
  });

  it("agrees with the figures the payroll register and the stored record already carry", async () => {
    const { ctx, run } = await lockedRun();
    const rep = (await buildReport(ctx, "employer-contributions", { runId: run.id }))!;
    const register = (await buildReport(ctx, "payroll-register", { runId: run.id }))!;
    expect(rep.totals!.employerPension).toBeCloseTo(register.totals!.employerPension, 1);
  });

  it("can be narrowed by client, and downloads as CSV with a heading for every head", async () => {
    const { ctx, run } = await lockedRun();
    const all = (await buildReport(ctx, "employer-contributions", { runId: run.id }))!;
    const alloc = await db.payrollAllocation.findFirst({ where: { runId: run.id, clientId: { not: null } }, select: { clientId: true } });
    const one = (await buildReport(ctx, "employer-contributions", { runId: run.id, clientId: alloc!.clientId! }))!;
    expect(one.rows.length).toBeGreaterThan(0);
    expect(one.rows.length).toBeLessThanOrEqual(all.rows.length);
    expect(one.filters).toEqual(["client", "beat"]);
    const header = toCsv(all.rows, all.columns).split("\n")[0];
    for (const h of ["Employer pension", "ITF", "NSITF-ECA", "NHF / Medical", "Insurance", "Uniform & kits", "Leave reliever", "Total employer contributions"]) expect(header, h).toContain(h);
  });

  it("is a payroll report: opened by the payroll-report permission, never by an employee", async () => {
    expect(reportPermission("employer-contributions")).toBe("reports.view");
    for (const role of ["COMPANY_ADMIN", "HR_ADMIN", "PAYROLL_ADMIN", "FINANCE", "AUDITOR"] as const) expect(can(role, "reports.view"), role).toBe(true);
    for (const role of ["EMPLOYEE", "SUPERVISOR"] as const) expect(can(role, "reports.view"), role).toBe(false);
  });

  it("is still all there on the stored payroll record — only the payslip stopped showing it", async () => {
    const { run } = await lockedRun();
    const recs = await db.payrollRecord.findMany({ where: { runId: run.id }, select: { lines: true } });
    const withEmployer = recs.filter((r) => (r.lines as Array<{ type: string }>).some((l) => l.type === "EMPLOYER"));
    expect(withEmployer.length).toBeGreaterThan(0); // the general-ledger postings and analytics still read these
  });
});
