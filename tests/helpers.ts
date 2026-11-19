import { db } from "@/lib/db";
import type { Ctx } from "@/lib/auth/context";

export async function ctxFor(role: Ctx["role"], orgCode = "DSS"): Promise<Ctx> {
  const org = await db.organization.findUniqueOrThrow({ where: { code: orgCode } });
  const user = await db.user.findFirst({ where: { organizationId: org.id, role } });
  if (!user) throw new Error(`No ${role} user in ${orgCode}`);
  return {
    userId: user.id,
    orgId: org.id,
    role,
    name: user.name,
    email: user.email,
    employeeId: user.employeeId,
  };
}

export async function employeeByNumber(ctx: Ctx, n: string) {
  return db.employee.findFirstOrThrow({ where: { organizationId: ctx.orgId, employeeNumber: n } });
}

export async function beatByName(ctx: Ctx, name: string) {
  return db.beat.findFirstOrThrow({ where: { organizationId: ctx.orgId, name } });
}

export async function periodFor(ctx: Ctx, year: number, month: number) {
  return db.payrollPeriod.findFirstOrThrow({ where: { organizationId: ctx.orgId, year, month } });
}

/**
 * CHANGED 2026-11-19 on purpose (demo company safeguards, approved by the founder): the seeded companies are demo companies (Organization.isDemo) and a demo company cannot generate a statutory remittance
 * or make a bank payment file, so a test that does so on the seeded company first makes it an ordinary company in the TEST database. It is never put back: tests run in parallel against one database, so
 * switching it back could block another test half-way. The test database is rebuilt from the seed on every run, and no test depends on the seeded company being a demo company (demo-company.test.ts uses its own).
 */
export async function treatAsRealCompany(orgId: string) {
  await db.organization.update({ where: { id: orgId }, data: { isDemo: false } });
}

export const uid = () => Math.random().toString(36).slice(2, 7).toUpperCase();

/**
 * A throwaway organization for tests that change org-wide settings (HR policy, checklist
 * templates…) or need exact counts — it can't interfere with the other test files, which all share
 * the seeded "DSS" org and run in parallel. Each role gets a distinct user id so maker/checker
 * rules (preparer ≠ approver) can be exercised.
 */
export async function isolatedOrg() {
  const code = `T${uid()}${uid()}`;
  const org = await db.organization.create({ data: { name: `Test org ${code}`, code } });
  const guard = await db.employeeCategory.create({ data: { organizationId: org.id, code: "GUARD", name: "Security Guard" } });
  const office = await db.employeeCategory.create({ data: { organizationId: org.id, code: "OFF", name: "Office Staff" } });
  const dept = await db.department.create({ data: { organizationId: org.id, code: "OPS", name: "Operations" } });
  const ctx = (role: Ctx["role"], employeeId: string | null = null, n = 1): Ctx => ({
    userId: `${code}-${role}-${n}`,
    orgId: org.id,
    role,
    name: `${role} ${n}`,
    email: `${role.toLowerCase()}${n}@${code.toLowerCase()}.test`,
    employeeId,
  });
  return { org, guardId: guard.id, officeId: office.id, deptId: dept.id, ctx };
}

/** Writes the explanation every variance finding on a run needs before it can be submitted (tests that only want to move a run along). */
export async function explainVariances(ctx: Ctx, runId: string) {
  const { explainIssue } = await import("@/server/services/payroll-controls");
  const open = await db.payrollValidationIssue.findMany({ where: { runId, requiresExplanation: true, explanation: null, overridden: false } });
  for (const i of open) await explainIssue(ctx, i.id, "Test: movement reviewed and accepted.");
}
