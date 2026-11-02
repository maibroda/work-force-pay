import { NextResponse } from "next/server";
import { refuseUnlessCronAuthorized } from "@/lib/cron-auth";
import { recordJob } from "@/server/services/job-runs";
import { sendChainHeads } from "@/server/services/audit-seal";

export const dynamic = "force-dynamic";

/** Scheduled job (weekly): emails each organization's audit chain head to the people who can view the audit log, so an altered or cut-off log is visible against an old email. */
async function handle(req: Request) {
  const refused = refuseUnlessCronAuthorized(req);
  if (refused) return refused;
  const results = await recordJob("audit-heads", () => sendChainHeads());
  return NextResponse.json({ ok: true, results });
}

export const GET = handle;
export const POST = handle;
