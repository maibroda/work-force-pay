import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import { db } from "@/lib/db";
import { ForbiddenError, type Permission, type Role } from "./permissions";
import { accessEnded, canCtx } from "@/lib/hr-functions";
import { iso } from "@/lib/dates";
import { loadGrantPermissions } from "@/server/services/hr-officers";
import type { Ctx } from "./context";
import { TwoFactorRequiredError, twoFactorStateFor } from "./two-factor-gate";
import { pageRefusal } from "@/server/services/entitlement-guard";
import { loadEntitlements } from "@/server/services/entitlement-switch";
import { mayWorkIn } from "./bureau-access";

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
      select: { sessionVersion: true, active: true, organizationId: true, role: true, accessEndsOn: true },
    });
    if (!current || !current.active || current.sessionVersion !== payload.sessionVersion) return null;
    // an external officer's access ends after their end date, whatever the token says
    if (accessEnded(current.accessEndsOn ? iso(current.accessEndsOn) : null, iso(new Date()))) return null;
    // Working in a client organization: the token says so, but access is re-checked against the database on every request, so
    // revoking someone's access (or deactivating them) takes effect at once and a token can't be made to point somewhere new.
    const orgId = String(payload.orgId);
    const acting = orgId !== current.organizationId;
    if (acting && !(await mayWorkIn({ id: userId, organizationId: current.organizationId, role: current.role as Role }, orgId))) return null;
    const h = await headers();
    return {
      userId,
      orgId,
      homeOrgId: acting ? current.organizationId : null,
      role: payload.role as Role,
      name: String(payload.name),
      email: String(payload.email),
      employeeId: (payload.employeeId as string) ?? null,
      ip: h.get("x-forwarded-for") ?? null,
      // undefined while every module's switch is OFF (the state until platform staff turn one on), which is what makes every guard allow
      entitlements: await loadEntitlements(orgId),
      // live function grants, read now: revoking one takes effect on the very next request
      grants: current.role === "HR_OFFICER" ? await loadGrantPermissions(userId) : undefined,
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
  if (permission && !canCtx(ctx, permission)) redirect("/forbidden");
  if (ctx.entitlements) {
    // the middleware sets this from the request's own address (overwriting anything the browser sent), so it holds on every visit, soft navigations included
    const off = pageRefusal(ctx, (await headers()).get("x-wfp-path"));
    if (off) redirect(off);
  }
  if (!opts.allowUnenrolled && (await twoFactorStateFor(ctx)).state === "BLOCKED") redirect("/settings/security");
  return ctx;
}

/** For server actions / route handlers: throws instead of redirecting. */
export async function requireAction(permission?: Permission, opts: GateOptions = {}): Promise<Ctx> {
  const ctx = await getSession();
  if (!ctx) throw new ForbiddenError("signed-in");
  if (permission && !canCtx(ctx, permission)) throw new ForbiddenError(permission);
  if (!opts.allowUnenrolled && (await twoFactorStateFor(ctx)).state === "BLOCKED") throw new TwoFactorRequiredError();
  return ctx;
}
