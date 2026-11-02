import { NextResponse } from "next/server";
import { refuseUnlessCronAuthorized } from "@/lib/cron-auth";
import { recordJob } from "@/server/services/job-runs";
import { runHealthJob } from "@/server/services/sales/health";

export const dynamic = "force-dynamic";

/** Scheduled job (nightly): recalculates the health score of every client account, and gives an at-risk account's owner a task. See refuseUnlessCronAuthorized for the secret. */
async function handle(req: Request) {
  const refused = refuseUnlessCronAuthorized(req);
  if (refused) return refused;
  const result = await recordJob("sales-health", () => runHealthJob());
  return NextResponse.json({ ok: true, ...result });
}

export const GET = handle;
export const POST = handle;
