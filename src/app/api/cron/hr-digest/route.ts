import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runDigestForAllOrgs } from "@/server/services/reminders";

export const dynamic = "force-dynamic";

/**
 * Scheduled job: sends each organization's HR digest. Protected by a shared secret —
 * `Authorization: Bearer $CRON_SECRET` (the form Vercel Cron and most schedulers send). With no
 * CRON_SECRET configured the endpoint is switched off rather than left open.
 */
async function handle(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured, so the digest job is switched off." }, { status: 503 });
  const header = req.headers.get("authorization") ?? "";
  const given = Buffer.from(header.startsWith("Bearer ") ? header.slice(7) : "");
  const expected = Buffer.from(secret);
  if (given.length !== expected.length || !timingSafeEqual(given, expected))
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const results = await runDigestForAllOrgs();
  return NextResponse.json({ ok: true, results });
}

export const GET = handle;
export const POST = handle;
