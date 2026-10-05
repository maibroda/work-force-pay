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
