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
