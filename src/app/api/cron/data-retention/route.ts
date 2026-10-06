import { NextResponse } from "next/server";
import { refuseUnlessCronAuthorized } from "@/lib/cron-auth";
import { runRetentionForAllOrgs } from "@/server/services/retention";

export const dynamic = "force-dynamic";

/** Scheduled job: removes personal details that have outlived each organization's retention period. */
async function handle(req: Request) {
  const refused = refuseUnlessCronAuthorized(req);
  if (refused) return refused;
  const results = await runRetentionForAllOrgs();
  return NextResponse.json({ ok: true, results });
}

export const GET = handle;
export const POST = handle;
