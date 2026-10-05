import { NextResponse, type NextRequest } from "next/server";

// /api/cron/* is called by a scheduler with no session — each route checks its own bearer secret.
const PUBLIC_PATHS = ["/login", "/forgot-password", "/reset-password", "/api/cron"];

// Cheap edge gate: no session cookie → login. Full verification + RBAC happens server-side per page/action.
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (
    PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`)) ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico"
  )
    return NextResponse.next();
  if (!req.cookies.get("wp_session")) return NextResponse.redirect(new URL("/login", req.url));
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
