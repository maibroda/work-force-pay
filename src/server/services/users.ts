import bcrypt from "bcryptjs";
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { assertCan, BusinessError, db } from "./_base";
import { logAudit } from "./audit";

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

/**
 * Returns null uniformly for "no such user", "wrong password", AND "account locked" — a locked
 * account never distinguishes itself from a bad password, so failed attempts can't be used to
 * enumerate which emails have accounts.
 */
export async function authenticate(email: string, password: string) {
  const user = await db.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  if (!user || !user.active) return null;
  if (user.lockedUntil && user.lockedUntil > new Date()) return null;
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    const attempts = user.failedLoginAttempts + 1;
    const locking = attempts >= MAX_FAILED_ATTEMPTS;
    await db.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: locking ? 0 : attempts,
        lockedUntil: locking ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null,
      },
    });
    if (locking)
      await logAudit(
        {
          userId: user.id,
          orgId: user.organizationId,
          role: user.role,
          name: user.name,
          email: user.email,
        },
        { action: "ACCOUNT_LOCKED", entity: "User", entityId: user.id, newValue: { attempts } },
      );
    return null;
  }
  await db.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date(), failedLoginAttempts: 0, lockedUntil: null },
  });
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
