import { NextResponse } from "next/server";
import type { Limiter } from "./rate-limit";

/** The "slow down" answer for a route, or null when the call may go ahead. A call that is refused is not counted. */
export function limitedResponse(limiter: Limiter, key: string): NextResponse | null {
  const r = limiter.check(key);
  if (r.ok) return null;
  return NextResponse.json({ error: `Too many requests. Try again in ${r.retryAfterSeconds} seconds.` }, { status: 429, headers: { "Retry-After": String(r.retryAfterSeconds), "Cache-Control": "no-store" } });
}
