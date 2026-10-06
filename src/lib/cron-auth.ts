import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

/**
 * Shared check for scheduled-job endpoints: `Authorization: Bearer $CRON_SECRET`. Returns a response
 * to send back when the call is refused, or null when it may proceed. With no CRON_SECRET configured
 * the job is switched off (503) rather than left open.
 */
export function refuseUnlessCronAuthorized(req: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured, so scheduled jobs are switched off." }, { status: 503 });
  const header = req.headers.get("authorization") ?? "";
  const given = Buffer.from(header.startsWith("Bearer ") ? header.slice(7) : "");
  const expected = Buffer.from(secret);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  return null;
}
