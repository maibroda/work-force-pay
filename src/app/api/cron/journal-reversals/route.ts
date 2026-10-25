import { NextResponse } from "next/server";
import { refuseUnlessCronAuthorized } from "@/lib/cron-auth";
import { recordJob } from "@/server/services/job-runs";
import { runDueReversalsForAllOrgs } from "@/server/services/journals";

export const dynamic = "force-dynamic";

/** Scheduled job: posts the automatic reversal of every accrual whose date has come, for every organization. */
async function handle(req: Request) {
  const refused = refuseUnlessCronAuthorized(req);
  if (refused) return refused;
  const results = await recordJob("journal-reversals", () => runDueReversalsForAllOrgs());
  return NextResponse.json({ ok: true, results });
}

export const GET = handle;
export const POST = handle;
