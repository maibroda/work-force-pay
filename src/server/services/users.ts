import bcrypt from "bcryptjs";
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { assertCan, BusinessError, db } from "./_base";
import { logAudit } from "./audit";
import { countLoginFailure, logUnknownAccount, recordAuthEvent, type AuthMeta } from "./auth-audit";
import { isLocked } from "@/lib/auth/login-guard";

/**
 * Returns null uniformly for "no such user", "wrong password", "account locked" AND "account switched off" — none distinguishes
 * itself from a bad password, so failed attempts can't be used to enumerate which emails have accounts.
 * Every failure is recorded (audit log for a real account, application log for an unknown email).
 * For an account with two-factor on, a correct password does NOT clear the failure count: only the whole sign-in succeeding does
 * (`completeSignIn`), so wrong codes cannot be interleaved with right passwords to dodge the lock.
 */
export async function authenticate(email: string, password: string, meta: AuthMeta = {}) {
  const user = await db.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  if (!user) {
    logUnknownAccount("Sign-in attempt for an unknown account", email, meta);
    return null;
  }
  if (!user.active) {
    await recordAuthEvent(user, "LOGIN_FAILED", "ACCOUNT_INACTIVE", meta, { step: "PASSWORD" });
    return null;
  }
  if (isLocked(user.lockedUntil, new Date())) {
    await recordAuthEvent(user, "LOGIN_FAILED", "ACCOUNT_LOCKED", meta, { step: "PASSWORD" });
    return null;
  }
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    await countLoginFailure(user, "PASSWORD", "WRONG_PASSWORD", meta);
    return null;
  }
  if (!user.totpEnabled) await completeSignIn(user.id);
  return user;
}

/** The whole sign-in has succeeded (password, and the two-factor code where it is on): clear the failure count and the lock, note the time. */
export async function completeSignIn(userId: string) {
  await db.user.update({ where: { id: userId }, data: { lastLoginAt: new Date(), failedLoginAttempts: 0, lockedUntil: null } });
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
    "BUSINESS_DEV",
  ]),
  password: z.string().min(8, "Password must be at least 8 characters"),
  employeeId: z.string().optional(),
});

export async function createUser(ctx: Ctx, raw: z.input<typeof userSchema>) {
  assertCan(ctx, "users.manage");
  const v = userSchema.parse(raw);
  const exists = await db.user.findUnique({ where: { email: v.email } });
  if (exists) throw new BusinessError("A user with this email already exists.");
  if (v.role === "BUSINESS_DEV" && !(await db.organization.findFirst({ where: { id: ctx.orgId, isBureau: true }, select: { id: true } })))
    throw new BusinessError("The business development role is for a payroll bureau's own sales people.");
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
