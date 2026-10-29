"use server";
import { setAuditAlertRecipients, verifyAuditNow } from "@/server/services/audit-seal";
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

/** Changes who is told when the audit log fails its check, and who gets the weekly chain head. */
export async function setAuditAlertRecipientsAction(v: Record<string, unknown>) {
  return act(
    "settings.manage",
    async (ctx) => {
      const extraEmails = String(v.extraEmails ?? "")
        .split(/[\n,;]+/)
        .map((x) => x.trim())
        .filter(Boolean);
      await setAuditAlertRecipients(ctx, { extraEmails, includeEveryone: v.includeEveryone === true });
      return { message: "Saved. Audit alerts will go to the people named here." };
    },
    ["/settings/audit-integrity"],
  );
}
