import { NextResponse } from "next/server";
import { refuseUnlessCronAuthorized } from "@/lib/cron-auth";
import { recordJob } from "@/server/services/job-runs";
import { sealAllOrganizations } from "@/server/services/audit-seal";

export const dynamic = "force-dynamic";

/** Scheduled job (every minute): seals the audit rows that are old enough and not yet sealed, so any later change to them can be detected. */
async function handle(req: Request) {
  const refused = refuseUnlessCronAuthorized(req);
  if (refused) return refused;
  const results = await recordJob("audit-seal", () => sealAllOrganizations());
  return NextResponse.json({ ok: true, results });
}

export const GET = handle;
export const POST = handle;
