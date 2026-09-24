import { describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import * as OTPAuth from "otpauth";
import { db } from "@/lib/db";
import type { Ctx } from "@/lib/auth/context";
import { authenticate, createUser } from "@/server/services/users";
import {
  beginTotpEnrollment,
  changeOwnPassword,
  confirmTotpEnrollment,
  disableTotp,
  logoutEverywhere,
  requestPasswordReset,
  resetPassword,
  verifyTotpLogin,
} from "@/server/services/security";
import * as emailLib from "@/lib/email";
import { ctxFor, uid } from "../helpers";

async function newTestUser() {
  const admin = await ctxFor("COMPANY_ADMIN");
  const user = await createUser(admin, {
    name: `Security Test ${uid()}`,
    email: `security.${uid()}@test.local`,
    role: "HR_ADMIN",
    password: "Password123!",
  });
  const ctx: Ctx = {
    userId: user.id,
    orgId: user.organizationId,
    role: user.role,
    name: user.name,
    email: user.email,
    employeeId: user.employeeId,
  };
  return { user, ctx };
}

describe("login rate limiting", () => {
  it("locks the account after 5 failed attempts and treats lockout identically to a bad password", async () => {
    const { user } = await newTestUser();

    for (let i = 0; i < 4; i++) expect(await authenticate(user.email, "wrong")).toBeNull();
    const locked = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(locked.lockedUntil).toBeNull(); // not yet — 4 failures

    expect(await authenticate(user.email, "wrong")).toBeNull(); // 5th failure locks it
    const afterLock = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(afterLock.lockedUntil).not.toBeNull();
    expect(afterLock.failedLoginAttempts).toBe(0);

    // even the CORRECT password fails while locked — no distinguishable signal
    expect(await authenticate(user.email, "Password123!")).toBeNull();

    // simulate the lockout expiring
    await db.user.update({ where: { id: user.id }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    const authed = await authenticate(user.email, "Password123!");
    expect(authed?.id).toBe(user.id);
  });
});

describe("password reset", () => {
  it("emails a single-use token that resets the password and revokes existing sessions", async () => {
    const { user } = await newTestUser();
    const spy = vi.spyOn(emailLib, "sendEmail").mockResolvedValue(undefined);

    await requestPasswordReset(user.email);
    expect(spy).toHaveBeenCalledOnce();
    const text = spy.mock.calls[0][0].text;
    const token = text.match(/token=(\S+)/)?.[1];
    expect(token).toBeTruthy();

    await resetPassword({ token: token!, password: "BrandNewPassword789!" });
    const updated = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await bcrypt.compare("BrandNewPassword789!", updated.passwordHash)).toBe(true);
    expect(updated.sessionVersion).toBe(2);

    // single-use
    await expect(resetPassword({ token: token!, password: "Whatever12345!" })).rejects.toThrow(
      /invalid or has expired/,
    );

    spy.mockRestore();
  });

  it("never reveals whether an email has an account", async () => {
    const spy = vi.spyOn(emailLib, "sendEmail").mockResolvedValue(undefined);
    await requestPasswordReset(`nobody.${uid()}@nowhere.test`);
    expect(spy).not.toHaveBeenCalled(); // silently no-ops — same as a real account from the caller's view
    spy.mockRestore();
  });

  it("rejects an expired token", async () => {
    const { user } = await newTestUser();
    const spy = vi.spyOn(emailLib, "sendEmail").mockResolvedValue(undefined);
    await requestPasswordReset(user.email);
    const match = spy.mock.calls[0][0].text.match(/token=(\S+)/);
    expect(match).toBeTruthy();
    const token = match![1];
    spy.mockRestore();
    await db.passwordResetToken.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(resetPassword({ token, password: "Whatever12345!" })).rejects.toThrow(
      /invalid or has expired/,
    );
  });
});

describe("self-service account security", () => {
  it("changeOwnPassword requires the current password and bumps sessionVersion", async () => {
    const { user, ctx } = await newTestUser();
    await expect(changeOwnPassword(ctx, "wrong-current", "NewPassword2026!")).rejects.toThrow(
      /Current password is incorrect/,
    );
    await changeOwnPassword(ctx, "Password123!", "NewPassword2026!");
    const updated = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await bcrypt.compare("NewPassword2026!", updated.passwordHash)).toBe(true);
    expect(updated.sessionVersion).toBe(2);
  });

  it("logoutEverywhere bumps sessionVersion", async () => {
    const { user, ctx } = await newTestUser();
    await logoutEverywhere(ctx);
    const updated = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updated.sessionVersion).toBe(2);
  });
});

describe("two-factor authentication (TOTP)", () => {
  it("requires a valid code to confirm enrollment, then verifies login codes and single-use backup codes", async () => {
    const { user, ctx } = await newTestUser();

    const enrollment = await beginTotpEnrollment(ctx);
    const totp = new OTPAuth.TOTP({
      issuer: "WorkforcePay",
      label: ctx.email,
      secret: OTPAuth.Secret.fromBase32(enrollment.secret),
    });

    await expect(confirmTotpEnrollment(ctx, "000000")).rejects.toThrow(/Incorrect code/);

    const backupCodes = await confirmTotpEnrollment(ctx, totp.generate());
    expect(backupCodes).toHaveLength(10);
    const enabled = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(enabled.totpEnabled).toBe(true);

    expect(await verifyTotpLogin(user.id, "000000")).toBe(false);
    expect(await verifyTotpLogin(user.id, totp.generate())).toBe(true);

    // each backup code works exactly once
    expect(await verifyTotpLogin(user.id, backupCodes[0])).toBe(true);
    expect(await verifyTotpLogin(user.id, backupCodes[0])).toBe(false);

    await expect(disableTotp(ctx, "000000")).rejects.toThrow(/Incorrect code/);
    await disableTotp(ctx, totp.generate());
    const disabled = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(disabled.totpEnabled).toBe(false);
    expect(disabled.backupCodes).toHaveLength(0);
  });
});
