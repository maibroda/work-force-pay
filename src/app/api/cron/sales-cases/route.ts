import { NextResponse } from "next/server";
import { refuseUnlessCronAuthorized } from "@/lib/cron-auth";
import { recordJob } from "@/server/services/job-runs";
import { runCasesJob } from "@/server/services/sales/cases";

export const dynamic = "force-dynamic";

/** Scheduled job (hourly is right): warns at 75% of a case's SLA window, flags and escalates a missed one, and opens a renewal deal for each contract ending soon. See refuseUnlessCronAuthorized for the secret. */
async function handle(req: Request) {
  const refused = refuseUnlessCronAuthorized(req);
  if (refused) return refused;
  const result = await recordJob("sales-cases", () => runCasesJob());
  return NextResponse.json({ ok: true, ...result });
}

export const GET = handle;
export const POST = handle;
