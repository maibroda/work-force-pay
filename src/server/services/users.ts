import bcrypt from "bcryptjs";
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { assertCan, BusinessError, db } from "./_base";
import { logAudit } from "./audit";

export async function authenticate(email: string, password: string) {
  const user = await db.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  if (!user || !user.active) return null;
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return null;
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return user;
}

export const userSchema = z.object({
  name: z.string().trim().min(2),
  email: z
    .string()
    .trim()
    .email()
    .transform((s) => s.toLowerCase()),
  role: z.enum([
    "COMPANY_ADMIN",
    "HR_ADMIN",
    "OPERATIONS",
    "PAYROLL_ADMIN",
    "FINANCE",
    "AUDITOR",
    "SUPERVISOR",
    "EMPLOYEE",
  ]),
  password: z.string().min(8, "Password must be at least 8 characters"),
  employeeId: z.string().optional(),
});

export async function createUser(ctx: Ctx, raw: z.input<typeof userSchema>) {
  assertCan(ctx, "users.manage");
  const v = userSchema.parse(raw);
  const exists = await db.user.findUnique({ where: { email: v.email } });
  if (exists) throw new BusinessError("A user with this email already exists.");
  if (v.employeeId) {
    const e = await db.employee.findFirst({ where: { id: v.employeeId, organizationId: ctx.orgId } });
    if (!e) throw new BusinessError("Employee not found.");
  }
  const u = await db.user.create({
    data: {
      organizationId: ctx.orgId,
      name: v.name,
      email: v.email,
      role: v.role,
      passwordHash: await bcrypt.hash(v.password, 10),
      employeeId: v.employeeId || null,
    },
  });
  await logAudit(ctx, {
    action: "USER_CREATE",
    entity: "User",
    entityId: u.id,
    newValue: { email: u.email, role: u.role },
  });
  return u;
}

export async function setUserActive(ctx: Ctx, id: string, active: boolean) {
  assertCan(ctx, "users.manage");
  if (id === ctx.userId) throw new BusinessError("You cannot deactivate yourself.");
  const u = await db.user.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!u) throw new BusinessError("User not found.");
  await db.user.update({ where: { id }, data: { active } });
  await logAudit(ctx, { action: active ? "USER_ACTIVATE" : "USER_DEACTIVATE", entity: "User", entityId: id });
}

export async function listUsers(ctx: Ctx) {
  return db.user.findMany({
    where: { organizationId: ctx.orgId },
    include: { employee: true },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });
}
