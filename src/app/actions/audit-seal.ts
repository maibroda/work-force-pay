"use server";
import { verifyAuditNow } from "@/server/services/audit-seal";
import { act } from "./_run";

/** "Check now" on the Audit integrity screen: seals what is waiting, checks the chain, and says what it found. */
export async function verifyAuditNowAction() {
  return act("audit.view", async (ctx) => {
    const r = await verifyAuditNow(ctx);
    if (r.ok) return { message: `Checked ${r.checked} sealed entries: no problems found.` };
    const first = r.findings.slice(0, 5).map((f) => `${f.kind} at entry ${f.seq}`).join("; ");
    return { message: `PROBLEMS FOUND: ${r.findingCount} in ${r.checked} sealed entries${first ? ` (${first})` : ""}${r.stalledRows ? `; ${r.stalledRows} entries have waited over 10 minutes to be sealed` : ""}. Do not assume this is a mistake.` };
  });
}
