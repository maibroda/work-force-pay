import { describe, expect, it } from "vitest";
import { hashEmail, isLocked, LOCKED_ATTEMPT_LOG_MINUTES, lockedAttemptLogDue, LOCKOUT_MINUTES, MAX_FAILED_ATTEMPTS, registerFailure, SECURITY_ACTIONS } from "@/lib/auth/login-guard";

/** The sign-in lockout arithmetic, the keyed hash used for emails with no account, and the list of security events. */
const now = new Date("2026-10-29T09:00:00Z");

describe("the lockout allowance", () => {
  it("is five failures in total (passwords and two-factor codes together), then fifteen minutes", () => {
    expect(MAX_FAILED_ATTEMPTS).toBe(5);
    expect(LOCKOUT_MINUTES).toBe(15);
  });
  it("counts up to four without locking", () => {
    for (let have = 0; have < 4; have++) {
      const r = registerFailure(have, now);
      expect(r).toEqual({ failedLoginAttempts: have + 1, lockedUntil: null, locking: false });
    }
  });
  it("locks on the fifth, for fifteen minutes, and starts the count again", () => {
    const r = registerFailure(4, now);
    expect(r.locking).toBe(true);
    expect(r.failedLoginAttempts).toBe(0);
    expect(r.lockedUntil).toEqual(new Date("2026-10-29T09:15:00Z"));
  });
  it("knows whether an account is locked: only while the time is in the future", () => {
    expect(isLocked(null, now)).toBe(false);
    expect(isLocked(new Date("2026-10-29T09:00:01Z"), now)).toBe(true);
    expect(isLocked(new Date("2026-10-29T09:00:00Z"), now)).toBe(false);
    expect(isLocked(new Date("2026-10-29T08:00:00Z"), now)).toBe(false);
  });
});

describe("attempts on a locked account are logged at most once every five minutes", () => {
  it("logs the first one, then not again until five minutes have passed", () => {
    expect(LOCKED_ATTEMPT_LOG_MINUTES).toBe(5);
    expect(lockedAttemptLogDue(null, now)).toBe(true);
    expect(lockedAttemptLogDue(new Date("2026-10-29T08:57:00Z"), now)).toBe(false);
    expect(lockedAttemptLogDue(new Date("2026-10-29T08:55:00Z"), now)).toBe(true);
    expect(lockedAttemptLogDue(new Date("2026-10-29T08:40:00Z"), now)).toBe(true);
  });
});

describe("the keyed hash of an email with no account (never the email itself)", () => {
  const key = "a-secret-key-of-at-least-32-characters-long";
  it("is stable, ignores case and spaces, and is sixteen hex characters", () => {
    const h = hashEmail("Someone@Example.com", key);
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(hashEmail("  someone@example.com ", key)).toBe(h);
  });
  it("differs by email and by key, so it cannot be looked up without the key", () => {
    expect(hashEmail("a@example.com", key)).not.toBe(hashEmail("b@example.com", key));
    expect(hashEmail("a@example.com", key)).not.toBe(hashEmail("a@example.com", `${key}-other`));
  });
  it("does not contain the email, or part of it", () => {
    const h = hashEmail("hunter2-typed-by-mistake@example.com", key);
    expect(h).not.toContain("hunter2");
    expect(h).not.toContain("example");
  });
  it("is something even a password typed into the email box cannot be read back from", () => {
    expect(hashEmail("My-Real-Password-9!", key)).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("the security events", () => {
  it("lists every action the audit page's Security events filter shows, including the sign-ins that worked", () => {
    expect([...SECURITY_ACTIONS].sort()).toEqual(
      [
        "ACCOUNT_LOCKED", "LOGIN", "LOGIN_FAILED", "LOGOUT", "LOGOUT_EVERYWHERE", "PASSWORD_CHANGE", "PASSWORD_CHANGE_FAILED", "PASSWORD_RESET",
        "PASSWORD_RESET_FAILED", "PASSWORD_RESET_REQUESTED", "TOTP_BACKUP_CODE_USED", "TOTP_DISABLED", "TOTP_DISABLE_FAILED", "TOTP_ENABLED", "TOTP_FAILED", "TWO_FACTOR_RESET",
        "AUDIT_ANCHOR_SENT", "AUDIT_INTEGRITY_CHECK", "AUDIT_INTEGRITY_FAILED", "AUDIT_REDACTION",
      ].sort(),
    );
  });
});
