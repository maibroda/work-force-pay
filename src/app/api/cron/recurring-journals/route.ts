import { NextResponse } from "next/server";
import { refuseUnlessCronAuthorized } from "@/lib/cron-auth";
import { generateDueForAllOrgs } from "@/server/services/recurring-journals";

export const dynamic = "force-dynamic";

/** Scheduled job: generates the journal drafts that recurring templates have come due for, for every organization. */
async function handle(req: Request) {
  const refused = refuseUnlessCronAuthorized(req);
  if (refused) return refused;
  const results = await generateDueForAllOrgs();
  return NextResponse.json({ ok: true, results });
}

export const GET = handle;
export const POST = handle;
