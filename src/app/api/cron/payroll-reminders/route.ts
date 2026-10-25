import { NextResponse } from "next/server";
import { refuseUnlessCronAuthorized } from "@/lib/cron-auth";
import { recordJob } from "@/server/services/job-runs";
import { runRemindersForAllOrgs } from "@/server/services/payroll-reminders";

export const dynamic = "force-dynamic";

/** Scheduled job (run it each morning): emails payroll deadline reminders for every client that has switched them on. See refuseUnlessCronAuthorized for the secret. */
async function handle(req: Request) {
  const refused = refuseUnlessCronAuthorized(req);
  if (refused) return refused;
  const results = await recordJob("payroll-reminders", () => runRemindersForAllOrgs());
  return NextResponse.json({ ok: true, results });
}

export const GET = handle;
export const POST = handle;
