import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import { db } from "@/lib/db";
import { can, ForbiddenError, type Permission, type Role } from "./permissions";
import type { Ctx } from "./context";
import { TwoFactorRequiredError, twoFactorStateFor } from "./two-factor-gate";

const COOKIE = "wp_session";
const MAX_AGE = 60 * 60 * 10; // 10 hours

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("AUTH_SECRET must be set (32+ chars)");
  return new TextEncoder().encode(s);
}

export async function createSession(ctx: Omit<Ctx, "ip">) {
  const user = await db.user.findUnique({ where: { id: ctx.userId }, select: { sessionVersion: true } });
  const token = await new SignJWT({ ...ctx, sessionVersion: user?.sessionVersion ?? 1 })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret());
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function destroySession() {
  const jar = await cookies();
  jar.delete(COOKIE);
}

/**
 * Verifies the session JWT AND that its embedded sessionVersion still matches the database —
 * a bumped sessionVersion (logout-everywhere, password change, deactivation) instantly
 * invalidates every outstanding token without needing a server-side session store.
 */
export async function getSession(): Promise<Ctx | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    const userId = String(payload.userId);
    const current = await db.user.findUnique({
      where: { id: userId },
      select: { sessionVersion: true, active: true },
    });
    if (!current || !current.active || current.sessionVersion !== payload.sessionVersion) return null;
    const h = await headers();
    return {
      userId,
      orgId: String(payload.orgId),
      role: payload.role as Role,
      name: String(payload.name),
      email: String(payload.email),
      employeeId: (payload.employeeId as string) ?? null,
      ip: h.get("x-forwarded-for") ?? null,
    };
  } catch {
    return null;
  }
}

const CHALLENGE_TTL = "5m";

/** Short-lived, cookie-less token passed between the password step and the TOTP step of login. */
export async function createLoginChallenge(userId: string): Promise<string> {
  return new SignJWT({ userId, purpose: "2fa" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(CHALLENGE_TTL)
    .sign(secret());
}

export async function verifyLoginChallenge(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    if (payload.purpose !== "2fa" || typeof payload.userId !== "string") return null;
    return payload.userId;
  } catch {
    return null;
  }
}

/** `allowUnenrolled`: reachable even by someone whose role must use two-factor and hasn't set it up (the page where they do). */
export interface GateOptions {
  allowUnenrolled?: boolean;
}

/** For pages: redirect to login when signed out, to /forbidden when not permitted, to My security when two-factor is compulsory and missing. */
export async function requirePage(permission?: Permission, opts: GateOptions = {}): Promise<Ctx> {
  const ctx = await getSession();
  if (!ctx) redirect("/login");
  if (permission && !can(ctx.role, permission)) redirect("/forbidden");
  if (!opts.allowUnenrolled && (await twoFactorStateFor(ctx)).state === "BLOCKED") redirect("/settings/security");
  return ctx;
}

/** For server actions / route handlers: throws instead of redirecting. */
export async function requireAction(permission?: Permission, opts: GateOptions = {}): Promise<Ctx> {
  const ctx = await getSession();
  if (!ctx) throw new ForbiddenError("signed-in");
  if (permission && !can(ctx.role, permission)) throw new ForbiddenError(permission);
  if (!opts.allowUnenrolled && (await twoFactorStateFor(ctx)).state === "BLOCKED") throw new TwoFactorRequiredError();
  return ctx;
}
