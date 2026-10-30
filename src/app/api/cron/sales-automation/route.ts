import { NextResponse } from "next/server";
import { refuseUnlessCronAuthorized } from "@/lib/cron-auth";
import { recordJob } from "@/server/services/job-runs";
import { runAutomationJob } from "@/server/services/sales/automation";

export const dynamic = "force-dynamic";

/** Scheduled job: notices deals that have gone quiet and carries out the automation runs that are due (delayed rules). See refuseUnlessCronAuthorized for the secret. */
async function handle(req: Request) {
  const refused = refuseUnlessCronAuthorized(req);
  if (refused) return refused;
  const result = await recordJob("sales-automation", () => runAutomationJob());
  return NextResponse.json({ ok: true, ...result });
}

export const GET = handle;
export const POST = handle;
