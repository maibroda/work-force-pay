import { NextResponse } from "next/server";
import { refuseUnlessCronAuthorized } from "@/lib/cron-auth";
import { recordJob } from "@/server/services/job-runs";
import { sendSalesDigests } from "@/server/services/sales/activities";

export const dynamic = "force-dynamic";

/** Scheduled job: emails each sales person their day (overdue and due tasks, reminders, deals gone quiet), once a day. See refuseUnlessCronAuthorized for the secret. */
async function handle(req: Request) {
  const refused = refuseUnlessCronAuthorized(req);
  if (refused) return refused;
  const result = await recordJob("sales-digest", () => sendSalesDigests());
  return NextResponse.json({ ok: true, ...result });
}

export const GET = handle;
export const POST = handle;
