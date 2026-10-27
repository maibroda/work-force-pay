import { afterEach, describe, expect, it, vi } from "vitest";
import * as OTPAuth from "otpauth";
import { db } from "@/lib/db";
import type { Ctx } from "@/lib/auth/context";
import { authenticate, completeSignIn, createUser } from "@/server/services/users";
import { changeOwnPassword, disableTotp, requestPasswordReset, resetPassword, verifyTotpLogin } from "@/server/services/security";
import { listAudit, logAudit } from "@/server/services/audit";
import { SECURITY_ACTIONS } from "@/lib/auth/login-guard";
import * as emailLib from "@/lib/email";
import { ctxFor, isolatedOrg, uid } from "../helpers";

/**
 * Rule 5: failed sign-ins are recorded, and the two-factor step can no longer be guessed without limit.
 * Everything here runs against the test database with throwaway users; no real account is touched.
 */
const PASSWORD = "Password123!";
const SECRET = "JBSWY3DPEHPK3PXP"; // a published demo secret: the test never uses a real one
const meta = { ip: "203.0.113.9", userAgent: "TestBrowser/1.0" };

async function newUser(opts: { twoFactor?: boolean } = {}) {
  const admin = await ctxFor("COMPANY_ADMIN");
  const created = await createUser(admin, { name: `Guard Test ${uid()}`, email: `guard.${uid()}@test.local`, role: "HR_ADMIN", password: PASSWORD });
  if (opts.twoFactor) await db.user.update({ where: { id: created.id }, data: { totpEnabled: true, totpSecret: SECRET, backupCodes: [] } });
  const user = await db.user.findUniqueOrThrow({ where: { id: created.id } });
  const ctx: Ctx = { userId: user.id, orgId: user.organizationId, role: user.role, name: user.name, email: user.email, employeeId: user.employeeId, ip: meta.ip };
  const totp = new OTPAuth.TOTP({ issuer: "WorkforcePay", label: user.email, secret: OTPAuth.Secret.fromBase32(SECRET) });
  /** A six-digit code that is not valid now, a step before or a step after (nor two steps either way, so a slow test cannot hit it). */
  let n = 0;
  const wrongCode = () => {
    const valid = new Set([-2, -1, 0, 1, 2].map((i) => totp.generate({ timestamp: Date.now() + i * 30_000 })));
    for (;;) {
      const c = String(100000 + 7919 * ++n).slice(0, 6);
      if (!valid.has(c)) return c;
    }
  };
  return { user, ctx, totp, wrongCode };
}

const state = (id: string) => db.user.findUniqueOrThrow({ where: { id }, select: { failedLoginAttempts: true, lockedUntil: true, lastLoginAt: true } });
const rows = (user: { id: string; organizationId: string }, action: string) =>
  db.auditLog.findMany({ where: { organizationId: user.organizationId, entityId: user.id, action }, orderBy: { createdAt: "asc" } });

afterEach(() => vi.restoreAllMocks());

describe("Part A: the second step can no longer be guessed without limit", () => {
  it("five wrong codes lock the account for 15 minutes; four do not", async () => {
    const { user, wrongCode } = await newUser({ twoFactor: true });
    for (let i = 0; i < 4; i++) expect(await verifyTotpLogin(user.id, wrongCode(), meta)).toBe(false);
    expect(await state(user.id)).toMatchObject({ failedLoginAttempts: 4, lockedUntil: null });
    expect(await verifyTotpLogin(user.id, wrongCode(), meta)).toBe(false);
    const after = await state(user.id);
    expect(after.lockedUntil!.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
    expect(after.lockedUntil!.getTime()).toBeLessThanOrEqual(Date.now() + 15 * 60_000 + 5_000);
    expect(after.failedLoginAttempts).toBe(0);
  });

  it("a right code is refused while the account is locked, and so is the right password", async () => {
    const { user, totp, wrongCode } = await newUser({ twoFactor: true });
    for (let i = 0; i < 5; i++) await verifyTotpLogin(user.id, wrongCode(), meta);
    expect(await verifyTotpLogin(user.id, totp.generate(), meta)).toBe(false);
    expect(await authenticate(user.email, PASSWORD, meta)).toBeNull();
  });

  it("wrong passwords and wrong codes share one counter", async () => {
    const { user, wrongCode } = await newUser({ twoFactor: true });
    await authenticate(user.email, "wrong-1", meta);
    await authenticate(user.email, "wrong-2", meta);
    for (let i = 0; i < 3; i++) await verifyTotpLogin(user.id, wrongCode(), meta);
    expect((await state(user.id)).lockedUntil).not.toBeNull();
  });

  it("a correct password does not clear the counter for an account with two-factor on, so wrong guesses cannot be interleaved with right passwords", async () => {
    const { user, wrongCode } = await newUser({ twoFactor: true });
    for (let i = 0; i < 4; i++) await verifyTotpLogin(user.id, wrongCode(), meta);
    expect((await authenticate(user.email, PASSWORD, meta))?.id).toBe(user.id); // password step passes…
    expect((await state(user.id)).failedLoginAttempts).toBe(4); // …but the count stays
    await verifyTotpLogin(user.id, wrongCode(), meta); // the fifth wrong guess locks
    expect((await state(user.id)).lockedUntil).not.toBeNull();
  });

  it("the whole sign-in succeeding (password, code, then completion) clears the counter and records the time", async () => {
    const { user, totp, wrongCode } = await newUser({ twoFactor: true });
    await authenticate(user.email, "wrong", meta);
    await verifyTotpLogin(user.id, wrongCode(), meta);
    expect((await state(user.id)).failedLoginAttempts).toBe(2);
    expect((await authenticate(user.email, PASSWORD, meta))?.id).toBe(user.id);
    expect(await verifyTotpLogin(user.id, totp.generate(), meta)).toBe(true);
    await completeSignIn(user.id);
    const done = await state(user.id);
    expect(done.failedLoginAttempts).toBe(0);
    expect(done.lastLoginAt).not.toBeNull();
  });

  it("an account without two-factor still has its counter cleared by the right password (as before)", async () => {
    const { user } = await newUser();
    await authenticate(user.email, "wrong", meta);
    await authenticate(user.email, "wrong", meta);
    expect((await state(user.id)).failedLoginAttempts).toBe(2);
    expect((await authenticate(user.email, PASSWORD, meta))?.id).toBe(user.id);
    const done = await state(user.id);
    expect(done.failedLoginAttempts).toBe(0);
    expect(done.lastLoginAt).not.toBeNull();
  });

  it("once the lock has expired the right code works again", async () => {
    const { user, totp, wrongCode } = await newUser({ twoFactor: true });
    for (let i = 0; i < 5; i++) await verifyTotpLogin(user.id, wrongCode(), meta);
    await db.user.update({ where: { id: user.id }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    expect(await verifyTotpLogin(user.id, totp.generate(), meta)).toBe(true);
  });

  it("twenty wrong codes sent at the same moment still end in a lock", async () => {
    const { user, wrongCode } = await newUser({ twoFactor: true });
    await Promise.all(Array.from({ length: 20 }, () => verifyTotpLogin(user.id, wrongCode(), meta)));
    expect((await state(user.id)).lockedUntil!.getTime()).toBeGreaterThan(Date.now());
  });

  it("an account that is switched off cannot get past the second step either", async () => {
    const { user, totp } = await newUser({ twoFactor: true });
    await db.user.update({ where: { id: user.id }, data: { active: false } });
    expect(await verifyTotpLogin(user.id, totp.generate(), meta)).toBe(false);
  });

  it("the replies are unchanged: a bad password, an unknown email, a locked and a switched-off account all give the same null", async () => {
    const a = await newUser();
    const locked = await newUser();
    await db.user.update({ where: { id: locked.user.id }, data: { lockedUntil: new Date(Date.now() + 60_000) } });
    const off = await newUser();
    await db.user.update({ where: { id: off.user.id }, data: { active: false } });
    expect(await authenticate(a.user.email, "wrong", meta)).toBeNull();
    expect(await authenticate(`nobody.${uid()}@nowhere.test`, "wrong", meta)).toBeNull();
    expect(await authenticate(locked.user.email, PASSWORD, meta)).toBeNull();
    expect(await authenticate(off.user.email, PASSWORD, meta)).toBeNull();
  });
});

describe("Part B: every failure is recorded in the account's own audit log", () => {
  it("a wrong password writes LOGIN_FAILED with the reason, the address and the browser, and the running count", async () => {
    const { user } = await newUser();
    await authenticate(user.email, "wrong-pw", meta);
    const [row] = await rows(user, "LOGIN_FAILED");
    expect(row).toBeDefined();
    expect(row.organizationId).toBe(user.organizationId);
    expect(row.entity).toBe("User");
    expect(row.userId).toBe(user.id);
    expect(row.reason).toBe("WRONG_PASSWORD");
    expect((row.metadata as { ip: string }).ip).toBe(meta.ip);
    expect(row.newValue).toMatchObject({ userAgent: meta.userAgent, step: "PASSWORD", attempts: 1 });
  });

  it("the fifth failure writes ACCOUNT_LOCKED saying whether passwords or codes caused it", async () => {
    const byPassword = await newUser();
    for (let i = 0; i < 5; i++) await authenticate(byPassword.user.email, "wrong", meta);
    expect((await rows(byPassword.user, "ACCOUNT_LOCKED"))[0].newValue).toMatchObject({ source: "PASSWORD" });

    const byCode = await newUser({ twoFactor: true });
    for (let i = 0; i < 5; i++) await verifyTotpLogin(byCode.user.id, byCode.wrongCode(), meta);
    expect((await rows(byCode.user, "ACCOUNT_LOCKED"))[0].newValue).toMatchObject({ source: "TOTP" });
    expect(await rows(byCode.user, "TOTP_FAILED")).toHaveLength(5);
  });

  it("a wrong two-factor code writes TOTP_FAILED", async () => {
    const { user, wrongCode } = await newUser({ twoFactor: true });
    await verifyTotpLogin(user.id, wrongCode(), meta);
    const [row] = await rows(user, "TOTP_FAILED");
    expect(row.reason).toBe("WRONG_CODE");
    expect(row.newValue).toMatchObject({ step: "TOTP", attempts: 1, userAgent: meta.userAgent });
    expect((row.metadata as { ip: string }).ip).toBe(meta.ip);
  });

  it("a switched-off account writes LOGIN_FAILED with its own reason", async () => {
    const { user } = await newUser();
    await db.user.update({ where: { id: user.id }, data: { active: false } });
    await authenticate(user.email, PASSWORD, meta);
    expect((await rows(user, "LOGIN_FAILED"))[0].reason).toBe("ACCOUNT_INACTIVE");
  });

  it("attempts on a locked account are logged at most once every five minutes, so the log cannot be flooded", async () => {
    const { user } = await newUser();
    for (let i = 0; i < 5; i++) await authenticate(user.email, "wrong", meta); // locks
    for (let i = 0; i < 50; i++) await authenticate(user.email, "wrong", meta);
    const locked = (await rows(user, "LOGIN_FAILED")).filter((r) => r.reason === "ACCOUNT_LOCKED");
    expect(locked).toHaveLength(1); // the five-minute rule itself is proved on the clock in login-guard.test.ts (the audit log cannot be back-dated)
  });

  it("an email with no account goes to the application log with a keyed hash, never to the audit log and never in readable form", async () => {
    const lines: string[] = [];
    for (const m of ["log", "warn", "error"] as const) vi.spyOn(console, m).mockImplementation((l: unknown) => void lines.push(String(l)));
    const typed = `Typed-Password-By-Mistake-${uid()}@nowhere.test`;
    expect(await authenticate(typed, "whatever", meta)).toBeNull();
    const out = lines.join("\n");
    expect(out).toMatch(/unknown account/i);
    expect(out).toContain(meta.ip);
    expect(out).toMatch(/"emailHash":"[0-9a-f]{16}"/);
    expect(out).not.toContain(typed);
    expect(out.toLowerCase()).not.toContain("typed-password-by-mistake");
    expect(await db.auditLog.count({ where: { action: "LOGIN_FAILED", createdAt: { gte: new Date(Date.now() - 5000) }, entityId: null } })).toBe(0);
  });
});

describe("Part B: password reset, password change and turning two-factor off", () => {
  it("asking for a reset email for a real account writes PASSWORD_RESET_REQUESTED; for an unknown email only the application log", async () => {
    const { user } = await newUser();
    vi.spyOn(emailLib, "sendEmail").mockResolvedValue(undefined);
    await requestPasswordReset(user.email, meta);
    const [row] = await rows(user, "PASSWORD_RESET_REQUESTED");
    expect(row).toBeDefined();
    expect((row.metadata as { ip: string }).ip).toBe(meta.ip);

    const lines: string[] = [];
    for (const m of ["log", "warn", "error"] as const) vi.spyOn(console, m).mockImplementation((l: unknown) => void lines.push(String(l)));
    const ghost = `ghost.${uid()}@nowhere.test`;
    await requestPasswordReset(ghost, meta);
    expect(lines.join("\n")).toMatch(/unknown account/i);
    expect(lines.join("\n")).not.toContain(ghost);
  });

  it("an expired or already-used reset link writes PASSWORD_RESET_FAILED against the account; the message to the caller is unchanged", async () => {
    const { user } = await newUser();
    const spy = vi.spyOn(emailLib, "sendEmail").mockResolvedValue(undefined);
    await requestPasswordReset(user.email, meta);
    const token = spy.mock.calls[0][0].text.match(/token=(\S+)/)![1];

    await resetPassword({ token, password: "BrandNewPassword789!" }, meta);
    await expect(resetPassword({ token, password: "Another12345678!" }, meta)).rejects.toThrow(/invalid or has expired/);
    expect((await rows(user, "PASSWORD_RESET_FAILED"))[0].reason).toBe("TOKEN_USED");

    await requestPasswordReset(user.email, meta);
    const token2 = spy.mock.calls[1][0].text.match(/token=(\S+)/)![1];
    await db.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(resetPassword({ token: token2, password: "Another12345678!" }, meta)).rejects.toThrow(/invalid or has expired/);
    expect((await rows(user, "PASSWORD_RESET_FAILED")).map((r) => r.reason)).toContain("TOKEN_EXPIRED");
  });

  it("a reset link nobody issued goes only to the application log, without the token", async () => {
    const lines: string[] = [];
    for (const m of ["log", "warn", "error"] as const) vi.spyOn(console, m).mockImplementation((l: unknown) => void lines.push(String(l)));
    const fake = `fake-token-canary-${uid()}-8842`;
    await expect(resetPassword({ token: fake, password: "Another12345678!" }, meta)).rejects.toThrow(/invalid or has expired/);
    const out = lines.join("\n");
    expect(out).toMatch(/unknown token/i);
    expect(out).not.toContain(fake);
    expect(out).not.toContain("Another12345678!");
  });

  it("a wrong current password writes PASSWORD_CHANGE_FAILED", async () => {
    const { user, ctx } = await newUser();
    await expect(changeOwnPassword(ctx, "wrong-current", "NewPassword2026!")).rejects.toThrow(/Current password is incorrect/);
    const [row] = await rows(user, "PASSWORD_CHANGE_FAILED");
    expect(row.reason).toBe("WRONG_CURRENT_PASSWORD");
    expect((row.metadata as { ip: string }).ip).toBe(meta.ip);
  });

  it("a wrong code when turning two-factor off writes TOTP_DISABLE_FAILED", async () => {
    const { user, ctx, wrongCode } = await newUser({ twoFactor: true });
    await expect(disableTotp(ctx, wrongCode())).rejects.toThrow(/Incorrect code/);
    expect((await rows(user, "TOTP_DISABLE_FAILED"))[0].reason).toBe("WRONG_CODE");
  });
});

describe("secrets never reach the audit log or the application log", () => {
  it("a recognisable password, code, new password and reset token appear in neither", async () => {
    const lines: string[] = [];
    for (const m of ["log", "warn", "error"] as const) vi.spyOn(console, m).mockImplementation((l: unknown) => void lines.push(String(l)));
    const { user, ctx } = await newUser({ twoFactor: true });
    const canaryPassword = `Canary-Pw-${uid()}-5521!`;
    const canaryCode = "135790";
    const canaryNew = `Canary-New-${uid()}-9034!`;
    const spy = vi.spyOn(emailLib, "sendEmail").mockResolvedValue(undefined);

    await authenticate(user.email, canaryPassword, meta);
    await verifyTotpLogin(user.id, canaryCode, meta);
    await authenticate(`${canaryPassword}@nowhere.test`, canaryPassword, meta);
    await changeOwnPassword(ctx, canaryPassword, canaryNew).catch(() => undefined);
    await disableTotp(ctx, canaryCode).catch(() => undefined);
    await requestPasswordReset(user.email, meta);
    const token = spy.mock.calls[0][0].text.match(/token=(\S+)/)![1];
    await db.passwordResetToken.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await resetPassword({ token, password: canaryNew }, meta).catch(() => undefined);

    const audit = JSON.stringify(await db.auditLog.findMany({ where: { organizationId: user.organizationId, OR: [{ entityId: user.id }, { userId: user.id }] } }));
    expect(audit).toContain("LOGIN_FAILED"); // the rows being searched exist
    const everything = `${audit}\n${lines.join("\n")}`;
    for (const secret of [canaryPassword, canaryCode, canaryNew, SECRET, token]) expect(everything).not.toContain(secret);
  });
});

describe("the Security events filter and tenant isolation", () => {
  it("listAudit({ security: true }) returns only security actions", async () => {
    const { user, ctx } = await newUser();
    await authenticate(user.email, "wrong", meta);
    await logAudit(ctx, { action: "SOMETHING_ELSE", entity: "Employee", entityId: user.id });
    const sec = await listAudit(ctx, { security: true, take: 1000 });
    expect(sec.length).toBeGreaterThan(0);
    for (const r of sec) expect(SECURITY_ACTIONS).toContain(r.action);
    expect(sec.some((r) => r.action === "SOMETHING_ELSE")).toBe(false);
    expect(sec.some((r) => r.entityId === user.id && r.action === "LOGIN_FAILED")).toBe(true);
  });

  it("failures for a user in one organization never appear in another organization's audit log", async () => {
    const { user } = await newUser();
    await authenticate(user.email, "wrong", meta);
    const other = await isolatedOrg();
    const seen = await listAudit(other.ctx("COMPANY_ADMIN"), { security: true, take: 1000 });
    expect(seen.filter((r) => r.entityId === user.id)).toHaveLength(0);
    expect(seen).toHaveLength(0);
  });
});
