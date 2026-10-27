import type { Ctx } from "@/lib/auth/context";
import { logger } from "@/lib/logger";
import { hashEmail, lockedAttemptLogDue, MAX_FAILED_ATTEMPTS, registerFailure } from "@/lib/auth/login-guard";
import { db } from "./_base";
import { logAudit } from "./audit";

/** Where a request came from. Passed in by the sign-in actions; never taken from the request body. */
export interface AuthMeta {
  ip?: string | null;
  userAgent?: string | null;
}

export interface AuthUser {
  id: string;
  organizationId: string;
  role: Ctx["role"];
  name: string;
  email: string;
}

/** The reasons for which repeated attempts are written at most once every five minutes. */
const THROTTLED_REASONS = new Set(["ACCOUNT_LOCKED", "ACCOUNT_INACTIVE"]);

/** The address header can carry a long, caller-written list; keep it short before it is stored. */
const clip = (s: string | null | undefined, max: number) => (s ? s.slice(0, max) : null);

/**
 * Writes one failure to the audit log of the account's own organization.
 * `details` must never hold a password, a two-factor code, a reset token or a sign-in challenge.
 */
export async function recordAuthEvent(user: AuthUser, action: string, reason: string | null, meta: AuthMeta = {}, details: Record<string, unknown> = {}) {
  if (reason && THROTTLED_REASONS.has(reason)) {
    const last = await db.auditLog.findFirst({
      where: { organizationId: user.organizationId, entityId: user.id, action, reason },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    if (!lockedAttemptLogDue(last?.createdAt, new Date())) return;
  }
  await logAudit(
    { userId: user.id, orgId: user.organizationId, role: user.role, name: user.name, email: user.email, ip: clip(meta.ip, 100) },
    { action, entity: "User", entityId: user.id, reason, newValue: { ...details, userAgent: clip(meta.userAgent, 200) } },
  );
}

/**
 * Counts one wrong password or wrong two-factor code against the account (same counter for both), locks it on the fifth, and records both.
 * The count is raised in the database in one step, so many guesses sent at the same moment cannot read the same old number.
 */
export async function countLoginFailure(user: AuthUser, step: "PASSWORD" | "TOTP", reason: string, meta: AuthMeta = {}) {
  const now = new Date();
  const { failedLoginAttempts: counted } = await db.user.update({ where: { id: user.id }, data: { failedLoginAttempts: { increment: 1 } }, select: { failedLoginAttempts: true } });
  const outcome = registerFailure(counted - 1, now);
  await recordAuthEvent(user, step === "PASSWORD" ? "LOGIN_FAILED" : "TOTP_FAILED", reason, meta, { step, attempts: outcome.locking ? MAX_FAILED_ATTEMPTS : counted });
  if (!outcome.locking) return;
  // Only the request that actually sets the lock writes ACCOUNT_LOCKED (others sent at the same moment find it already set).
  const locked = await db.user.updateMany({
    where: { id: user.id, OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }] },
    data: { failedLoginAttempts: 0, lockedUntil: outcome.lockedUntil },
  });
  if (locked.count > 0) await recordAuthEvent(user, "ACCOUNT_LOCKED", "TOO_MANY_FAILURES", meta, { source: step, attempts: MAX_FAILED_ATTEMPTS });
  else await db.user.update({ where: { id: user.id }, data: { failedLoginAttempts: 0 } }); // already locked by a request sent at the same moment: no count left over
}

/** A reset link nobody issued: no account to attach it to, and the token itself is never written anywhere. */
export function logUnknownResetToken(meta: AuthMeta = {}) {
  logger.warn("Password reset attempted with an unknown token", { ip: clip(meta.ip, 100), userAgent: clip(meta.userAgent, 200) });
}

/** An address that has no account cannot go in the audit log (every row belongs to an organization). The application log gets a keyed hash, never the address. */
export function logUnknownAccount(what: string, email: string, meta: AuthMeta = {}) {
  const key = `auth-log:${process.env.AUTH_SECRET ?? ""}`;
  logger.warn(what, { emailHash: hashEmail(email, key), ip: clip(meta.ip, 100), userAgent: clip(meta.userAgent, 200) });
}
