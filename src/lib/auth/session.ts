import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import { can, ForbiddenError, type Permission, type Role } from "./permissions";
import type { Ctx } from "./context";

const COOKIE = "wp_session";
const MAX_AGE = 60 * 60 * 10; // 10 hours

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("AUTH_SECRET must be set (32+ chars)");
  return new TextEncoder().encode(s);
}

export async function createSession(ctx: Omit<Ctx, "ip">) {
  const token = await new SignJWT({ ...ctx })
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

export async function getSession(): Promise<Ctx | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    const h = await headers();
    return {
      userId: String(payload.userId),
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

/** For pages: redirect to login when signed out, to /forbidden when not permitted. */
export async function requirePage(permission?: Permission): Promise<Ctx> {
  const ctx = await getSession();
  if (!ctx) redirect("/login");
  if (permission && !can(ctx.role, permission)) redirect("/forbidden");
  return ctx;
}

/** For server actions / route handlers: throws instead of redirecting. */
export async function requireAction(permission?: Permission): Promise<Ctx> {
  const ctx = await getSession();
  if (!ctx) throw new ForbiddenError("signed-in");
  if (permission && !can(ctx.role, permission)) throw new ForbiddenError(permission);
  return ctx;
}
