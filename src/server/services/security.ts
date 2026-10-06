import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import * as OTPAuth from "otpauth";
import QRCode from "qrcode";
import type { Ctx } from "@/lib/auth/context";
import { sendEmail } from "@/lib/email";
import { twoFactorStateFor } from "@/lib/auth/two-factor-gate";
import { ROLE_PERMISSIONS } from "@/lib/auth/permissions";
import { d, iso } from "@/lib/dates";
import { twoFactorState } from "@/lib/two-factor-policy";
import { assertCan, BusinessError, db } from "./_base";
import { logAudit } from "./audit";
import { todayUtc } from "./hr-policy";

const RESET_TOKEN_TTL_MINUTES = 30;
const BACKUP_CODE_COUNT = 10;
const TOTP_ISSUER = "WorkforcePay";

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// ─────────────────────────────── Password reset ───────────────────────────────

/** Always resolves — never reveals whether the email belongs to an account. */
export async function requestPasswordReset(email: string) {
  const user = await db.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  if (!user || !user.active) return;
  const token = crypto.randomBytes(32).toString("base64url");
  await db.passwordResetToken.create({
    data: {
      organizationId: user.organizationId,
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60_000),
    },
  });
  const resetUrl = `${process.env.APP_URL ?? "http://localhost:3000"}/reset-password?token=${token}`;
  await sendEmail({
    to: user.email,
    subject: "Reset your WorkforcePay password",
    text: `Reset your password: ${resetUrl}\n\nThis link expires in ${RESET_TOKEN_TTL_MINUTES} minutes. If you didn't request this, ignore this email — your password will not change.`,
    html: `<p>Reset your password by clicking the link below:</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>This link expires in ${RESET_TOKEN_TTL_MINUTES} minutes. If you didn't request this, ignore this email — your password will not change.</p>`,
  });
}

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

/** Consumes a single-use reset token, sets the new password, and logs out every existing session. */
export async function resetPassword(raw: z.input<typeof resetPasswordSchema>) {
  const v = resetPasswordSchema.parse(raw);
  const record = await db.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(v.token) },
    include: { user: true },
  });
  if (!record || record.usedAt || record.expiresAt < new Date())
    throw new BusinessError("This reset link is invalid or has expired — request a new one.");
  const passwordHash = await bcrypt.hash(v.password, 10);
  await db.$transaction([
    db.user.update({
      where: { id: record.userId },
      data: {
        passwordHash,
        sessionVersion: { increment: 1 },
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    }),
    db.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
  ]);
  await logAudit(
    {
      userId: record.userId,
      orgId: record.organizationId,
      role: record.user.role,
      name: record.user.name,
      email: record.user.email,
    },
    { action: "PASSWORD_RESET", entity: "User", entityId: record.userId },
  );
}

/** Self-service change while logged in — requires the current password, logs out other sessions. */
export async function changeOwnPassword(ctx: Ctx, currentPassword: string, newPassword: string) {
  if (newPassword.length < 8) throw new BusinessError("Password must be at least 8 characters.");
  const user = await db.user.findUniqueOrThrow({ where: { id: ctx.userId } });
  const ok = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!ok) throw new BusinessError("Current password is incorrect.");
  await db.user.update({
    where: { id: ctx.userId },
    data: { passwordHash: await bcrypt.hash(newPassword, 10), sessionVersion: { increment: 1 } },
  });
  await logAudit(ctx, { action: "PASSWORD_CHANGE", entity: "User", entityId: ctx.userId });
}

export async function getOwnSecurityInfo(ctx: Ctx) {
  const user = await db.user.findUniqueOrThrow({
    where: { id: ctx.userId },
    select: { totpEnabled: true, totpVerifiedAt: true },
  });
  return user;
}

// ─────────────────────────────── Session revocation ───────────────────────────────

/** Invalidates every outstanding session for this user — including the one making the request. */
export async function logoutEverywhere(ctx: Ctx) {
  await db.user.update({ where: { id: ctx.userId }, data: { sessionVersion: { increment: 1 } } });
  await logAudit(ctx, { action: "LOGOUT_EVERYWHERE", entity: "User", entityId: ctx.userId });
}

// ─────────────────────────────── Two-factor authentication (TOTP) ───────────────────────────────

export interface TotpEnrollment {
  secret: string;
  qrDataUrl: string;
}

function totpFor(email: string, secretBase32: string) {
  return new OTPAuth.TOTP({
    issuer: TOTP_ISSUER,
    label: email,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
}

/** Generates a new (unconfirmed) secret — 2FA stays off until confirmTotpEnrollment succeeds. */
export async function beginTotpEnrollment(ctx: Ctx): Promise<TotpEnrollment> {
  const secret = new OTPAuth.Secret({ size: 20 });
  await db.user.update({
    where: { id: ctx.userId },
    data: { totpSecret: secret.base32, totpEnabled: false, totpVerifiedAt: null },
  });
  const qrDataUrl = await QRCode.toDataURL(totpFor(ctx.email, secret.base32).toString());
  return { secret: secret.base32, qrDataUrl };
}

function randomBackupCode() {
  return crypto.randomBytes(5).toString("hex");
}

/** Verifies the first code from the authenticator app, turns 2FA on, and issues backup codes. */
export async function confirmTotpEnrollment(ctx: Ctx, code: string): Promise<string[]> {
  const user = await db.user.findUniqueOrThrow({ where: { id: ctx.userId } });
  if (!user.totpSecret) throw new BusinessError("Start enrollment first.");
  if (totpFor(ctx.email, user.totpSecret).validate({ token: code, window: 1 }) === null)
    throw new BusinessError("Incorrect code — check your authenticator app and try again.");
  const codes = Array.from({ length: BACKUP_CODE_COUNT }, randomBackupCode);
  const hashed = await Promise.all(codes.map((c) => bcrypt.hash(c, 10)));
  await db.user.update({
    where: { id: ctx.userId },
    data: { totpEnabled: true, totpVerifiedAt: new Date(), backupCodes: hashed },
  });
  await logAudit(ctx, { action: "TOTP_ENABLED", entity: "User", entityId: ctx.userId });
  return codes;
}

export async function disableTotp(ctx: Ctx, code: string) {
  if ((await twoFactorStateFor(ctx)).state === "ENROLLED")
    throw new BusinessError("Your role must sign in with two-factor authentication, so it can't be turned off.");
  const user = await db.user.findUniqueOrThrow({ where: { id: ctx.userId } });
  if (!user.totpEnabled || !user.totpSecret)
    throw new BusinessError("Two-factor authentication is not enabled.");
  if (totpFor(ctx.email, user.totpSecret).validate({ token: code, window: 1 }) === null)
    throw new BusinessError("Incorrect code.");
  await db.user.update({
    where: { id: ctx.userId },
    data: { totpEnabled: false, totpSecret: null, totpVerifiedAt: null, backupCodes: [] },
  });
  await logAudit(ctx, { action: "TOTP_DISABLED", entity: "User", entityId: ctx.userId });
}

/** Login-time verification — accepts the current TOTP code or a single-use backup code. */
export async function verifyTotpLogin(userId: string, code: string): Promise<boolean> {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user || !user.totpEnabled || !user.totpSecret) return false;
  if (totpFor(user.email, user.totpSecret).validate({ token: code, window: 1 }) !== null) return true;
  for (const hash of user.backupCodes) {
    if (await bcrypt.compare(code, hash)) {
      await db.user.update({
        where: { id: userId },
        data: { backupCodes: user.backupCodes.filter((h) => h !== hash) },
      });
      await logAudit(
        { userId: user.id, orgId: user.organizationId, role: user.role, name: user.name, email: user.email },
        { action: "TOTP_BACKUP_CODE_USED", entity: "User", entityId: user.id },
      );
      return true;
    }
  }
  return false;
}

// ─────────────────────────────── Requiring two-factor by role ───────────────────────────────

export const ROLES = Object.keys(ROLE_PERMISSIONS);

/** Which roles must use two-factor and from what day, and who in those roles hasn't set it up yet. */
export async function getTwoFactorRequirement(ctx: Ctx) {
  assertCan(ctx, "users.manage");
  const p = await db.hrPolicy.findUnique({ where: { organizationId: ctx.orgId }, select: { twoFactorRoles: true, twoFactorEnforceFrom: true } });
  const roles: string[] = p?.twoFactorRoles ?? [];
  const enforceFrom = p?.twoFactorEnforceFrom ?? null;
  const users = roles.length
    ? await db.user.findMany({ where: { organizationId: ctx.orgId, active: true, role: { in: roles as never[] } }, select: { id: true, name: true, email: true, role: true, totpEnabled: true }, orderBy: [{ role: "asc" }, { name: "asc" }] })
    : [];
  const today = todayUtc();
  const rows = users.map((u) => ({ ...u, state: twoFactorState({ roles, enforceFrom, role: u.role, enrolled: u.totpEnabled, today }) }));
  return { roles, enforceFrom, rows, missing: rows.filter((r) => !r.totpEnabled).length, covered: rows.length };
}

export const twoFactorRequirementSchema = z.object({
  roles: z.array(z.string()).max(20),
  enforceFrom: z.string().optional(),
});

/** Sets the roles that must use two-factor and the first day it is compulsory. No roles = switched off. */
export async function setTwoFactorRequirement(ctx: Ctx, raw: z.input<typeof twoFactorRequirementSchema>) {
  assertCan(ctx, "users.manage");
  const v = twoFactorRequirementSchema.parse(raw);
  const roles = [...new Set(v.roles)];
  const bad = roles.find((r) => !ROLES.includes(r));
  if (bad) throw new BusinessError(`${bad} isn't a role.`);
  let enforceFrom: Date | null = null;
  if (roles.length) {
    if (!v.enforceFrom) throw new BusinessError("Choose the first day two-factor becomes compulsory (today is fine — nothing is switched off before then).");
    enforceFrom = d(v.enforceFrom);
    if (Number.isNaN(enforceFrom.getTime())) throw new BusinessError("That date isn't valid.");
    // Don't let the person making the change lock themselves (and so possibly everyone) out.
    if (enforceFrom <= todayUtc() && roles.includes(ctx.role)) {
      const me = await db.user.findUnique({ where: { id: ctx.userId }, select: { totpEnabled: true } });
      if (!me?.totpEnabled) throw new BusinessError("Turn on two-factor for your own account first (My security), or this would lock you out as soon as it's saved.");
    }
  }
  const old = await db.hrPolicy.findUnique({ where: { organizationId: ctx.orgId }, select: { twoFactorRoles: true, twoFactorEnforceFrom: true } });
  await db.hrPolicy.update({ where: { organizationId: ctx.orgId }, data: { twoFactorRoles: roles as never[], twoFactorEnforceFrom: enforceFrom } });
  await logAudit(ctx, {
    action: "TWO_FACTOR_REQUIREMENT",
    entity: "HrPolicy",
    entityId: ctx.orgId,
    oldValue: { roles: old?.twoFactorRoles ?? [], enforceFrom: old?.twoFactorEnforceFrom ? iso(old.twoFactorEnforceFrom) : null },
    newValue: { roles, enforceFrom: enforceFrom ? iso(enforceFrom) : null },
  });
}

/**
 * For someone who has lost their phone and their backup codes: switches their two-factor off so they can sign in
 * with their password and set it up again. Never your own account, and always with a reason on the record.
 */
export async function resetUserTwoFactor(ctx: Ctx, userId: string, reason: string) {
  assertCan(ctx, "users.manage");
  if (userId === ctx.userId) throw new BusinessError("You can't reset your own two-factor — use your backup codes, or ask another administrator.");
  if (!reason || reason.trim().length < 10) throw new BusinessError("Say why (and how you checked it's really them) — this removes a safeguard from their account.");
  const u = await db.user.findFirst({ where: { id: userId, organizationId: ctx.orgId } });
  if (!u) throw new BusinessError("User not found.");
  if (!u.totpEnabled) throw new BusinessError("They don't have two-factor turned on.");
  await db.user.update({
    where: { id: userId },
    data: { totpEnabled: false, totpSecret: null, totpVerifiedAt: null, backupCodes: [], sessionVersion: { increment: 1 } },
  });
  await logAudit(ctx, { action: "TWO_FACTOR_RESET", entity: "User", entityId: userId, reason, newValue: { email: u.email } });
}
