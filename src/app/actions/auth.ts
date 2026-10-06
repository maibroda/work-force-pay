"use server";
import { redirect } from "next/navigation";
import type { User } from "@prisma/client";
import { db } from "@/lib/db";
import {
  createLoginChallenge,
  createSession,
  destroySession,
  getSession,
  verifyLoginChallenge,
} from "@/lib/auth/session";
import { authenticate } from "@/server/services/users";
import * as security from "@/server/services/security";
import { logAudit } from "@/server/services/audit";
import { act } from "./_run";

export interface LoginState {
  error?: string;
  needsTotp?: boolean;
  challenge?: string;
}

function redirectPath(role: User["role"]) {
  return role === "EMPLOYEE" ? "/me" : role === "SUPERVISOR" ? "/supervisor" : "/";
}

async function completeLogin(user: User): Promise<never> {
  const ctx = {
    userId: user.id,
    orgId: user.organizationId,
    role: user.role,
    name: user.name,
    email: user.email,
    employeeId: user.employeeId,
  };
  await createSession(ctx);
  await logAudit(ctx, { action: "LOGIN", entity: "User", entityId: user.id });
  return redirect(redirectPath(user.role));
}

const LOCKED_OR_INVALID =
  "Invalid email or password, or your account is temporarily locked after repeated failed attempts — try again in a few minutes.";

export async function loginAction(_prev: LoginState | undefined, form: FormData): Promise<LoginState> {
  const email = String(form.get("email") ?? "");
  const password = String(form.get("password") ?? "");
  const user = await authenticate(email, password);
  if (!user) return { error: LOCKED_OR_INVALID };
  if (user.totpEnabled) return { needsTotp: true, challenge: await createLoginChallenge(user.id) };
  return completeLogin(user);
}

export async function verifyTotpLoginAction(
  _prev: LoginState | undefined,
  form: FormData,
): Promise<LoginState> {
  const challenge = String(form.get("challenge") ?? "");
  const code = String(form.get("code") ?? "").replace(/\s+/g, "");
  const userId = await verifyLoginChallenge(challenge);
  if (!userId) return { error: "Your sign-in session expired — please start again." };
  const ok = await security.verifyTotpLogin(userId, code);
  if (!ok) return { error: "Incorrect code.", needsTotp: true, challenge };
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  return completeLogin(user);
}

export async function logoutAction() {
  const ctx = await getSession();
  if (ctx) await logAudit(ctx, { action: "LOGOUT", entity: "User", entityId: ctx.userId });
  await destroySession();
  redirect("/login");
}

// ─────────────────────────────── Forgot / reset password ───────────────────────────────

export interface SimpleState {
  ok?: boolean;
  error?: string;
}

export async function requestPasswordResetAction(
  _prev: SimpleState | undefined,
  form: FormData,
): Promise<SimpleState> {
  const email = String(form.get("email") ?? "");
  await security.requestPasswordReset(email);
  // Always the same response — never reveals whether the email exists.
  return { ok: true };
}

export async function resetPasswordAction(
  _prev: SimpleState | undefined,
  form: FormData,
): Promise<SimpleState> {
  try {
    await security.resetPassword({
      token: String(form.get("token") ?? ""),
      password: String(form.get("password") ?? ""),
    });
  } catch (e) {
    return { error: (e as Error).message };
  }
  redirect("/login?reset=1");
}

// ─────────────────────────────── Account security (self-service) ───────────────────────────────

export async function changePasswordAction(v: Record<string, unknown>) {
  return act(undefined, async (ctx) => {
    await security.changeOwnPassword(ctx, String(v.currentPassword), String(v.newPassword));
    return { message: "Password changed. You'll need to sign in again on your other devices." };
  }, [], { allowUnenrolled: true });
}

export async function logoutEverywhereAction() {
  return act(undefined, async (ctx) => {
    await security.logoutEverywhere(ctx);
    return { message: "Signed out of every device, including this one on next page load." };
  }, [], { allowUnenrolled: true });
}

export async function beginTotpEnrollmentAction() {
  return act(undefined, async (ctx) => {
    const enrollment = await security.beginTotpEnrollment(ctx);
    return { message: "Scan the QR code, then enter a code to confirm.", data: enrollment };
  }, [], { allowUnenrolled: true });
}

export async function confirmTotpEnrollmentAction(v: Record<string, unknown>) {
  return act(undefined, async (ctx) => {
    const backupCodes = await security.confirmTotpEnrollment(ctx, String(v.code));
    return { message: "Two-factor authentication is now on. Save your backup codes.", data: { backupCodes } };
  }, [], { allowUnenrolled: true });
}

export async function disableTotpAction(v: Record<string, unknown>) {
  return act(undefined, async (ctx) => {
    await security.disableTotp(ctx, String(v.code));
    return { message: "Two-factor authentication turned off." };
  });
}

// ─────────────────────────────── Two-factor requirement (administrators) ───────────────────────────────

export async function setTwoFactorRequirementAction(v: Record<string, unknown>) {
  return act("users.manage", async (ctx) => {
    // one tick box per role (role_HR_ADMIN …)
    const roles = Object.keys(v).filter((k) => k.startsWith("role_") && v[k] === true).map((k) => k.slice(5));
    await security.setTwoFactorRequirement(ctx, { roles, enforceFrom: v.enforceFrom ? String(v.enforceFrom) : undefined });
    return { message: roles.length ? "Two-factor requirement saved." : "Two-factor is no longer required for any role." };
  }, ["/settings"]);
}

export async function resetUserTwoFactorAction(userId: string, reason?: string) {
  return act("users.manage", async (ctx) => {
    await security.resetUserTwoFactor(ctx, userId, reason ?? "");
    return { message: "Two-factor switched off for that user. They must set it up again." };
  }, ["/settings"]);
}
