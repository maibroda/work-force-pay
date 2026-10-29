import { NextResponse } from "next/server";
import { refuseUnlessCronAuthorized } from "@/lib/cron-auth";
import { recordJob } from "@/server/services/job-runs";
import { verifyAllOrganizations } from "@/server/services/audit-seal";

export const dynamic = "force-dynamic";

/** Scheduled job (daily): checks every organization's audit seals against its audit log; a failure is recorded and emailed. */
async function handle(req: Request) {
  const refused = refuseUnlessCronAuthorized(req);
  if (refused) return refused;
  const results = await recordJob("audit-verify", () => verifyAllOrganizations());
  return NextResponse.json({ ok: true, results });
}

export const GET = handle;
export const POST = handle;
