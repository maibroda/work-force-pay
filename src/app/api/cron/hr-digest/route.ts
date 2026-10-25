import { NextResponse } from "next/server";
import { refuseUnlessCronAuthorized } from "@/lib/cron-auth";
import { recordJob } from "@/server/services/job-runs";
import { runDigestForAllOrgs } from "@/server/services/reminders";

export const dynamic = "force-dynamic";

/** Scheduled job: sends each organization's HR digest. See refuseUnlessCronAuthorized for the secret. */
async function handle(req: Request) {
  const refused = refuseUnlessCronAuthorized(req);
  if (refused) return refused;
  const results = await recordJob("hr-digest", () => runDigestForAllOrgs());
  return NextResponse.json({ ok: true, results });
}

export const GET = handle;
export const POST = handle;
