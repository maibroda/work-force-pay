import { createHmac } from "node:crypto";

/**
 * Sign-in lockout arithmetic and the list of security events. Pure: no database, no clock of its own.
 * A wrong password and a wrong two-factor code count on the SAME counter, so five failures in total lock the account.
 */
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_MINUTES = 15;
/** While an account is locked, repeated attempts are written to the audit log at most this often. */
export const LOCKED_ATTEMPT_LOG_MINUTES = 5;

/** `have` = failures already counted; returns what to store after one more failure. The count restarts at 0 when the lock is set. */
export function registerFailure(have: number, now: Date) {
  const attempts = have + 1;
  const locking = attempts >= MAX_FAILED_ATTEMPTS;
  return {
    failedLoginAttempts: locking ? 0 : attempts,
    lockedUntil: locking ? new Date(now.getTime() + LOCKOUT_MINUTES * 60_000) : null,
    locking,
  };
}

export const isLocked = (lockedUntil: Date | null | undefined, now: Date) => !!lockedUntil && lockedUntil > now;

/** Whether an attempt on a locked account should be written to the audit log, given when one was last written. */
export const lockedAttemptLogDue = (lastLoggedAt: Date | null | undefined, now: Date) =>
  !lastLoggedAt || now.getTime() - lastLoggedAt.getTime() >= LOCKED_ATTEMPT_LOG_MINUTES * 60_000;

/**
 * A keyed hash for an email that has no account, so the application log can show "the same address again" without ever holding the address
 * (people type passwords into the email box). Without the key it cannot be looked up.
 */
export const hashEmail = (email: string, key: string) =>
  createHmac("sha256", key).update(email.toLowerCase().trim()).digest("hex").slice(0, 16);

/** Every audit action that is a security event: what the audit page's "Security events" filter shows. */
export const SECURITY_ACTIONS = [
  "LOGIN",
  "LOGOUT",
  "LOGOUT_EVERYWHERE",
  "LOGIN_FAILED",
  "TOTP_FAILED",
  "ACCOUNT_LOCKED",
  "PASSWORD_CHANGE",
  "PASSWORD_CHANGE_FAILED",
  "PASSWORD_RESET",
  "PASSWORD_RESET_REQUESTED",
  "PASSWORD_RESET_FAILED",
  "TOTP_ENABLED",
  "TOTP_DISABLED",
  "TOTP_DISABLE_FAILED",
  "TOTP_BACKUP_CODE_USED",
  "TWO_FACTOR_RESET",
] as const;
