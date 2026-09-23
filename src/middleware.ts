import { NextResponse, type NextRequest } from "next/server";

// Cheap edge gate: no session cookie → login. Full verification + RBAC happens server-side per page/action.
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/login") || pathname.startsWith("/_next") || pathname === "/favicon.ico")
    return NextResponse.next();
  if (!req.cookies.get("wp_session")) return NextResponse.redirect(new URL("/login", req.url));
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
