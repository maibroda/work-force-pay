import type { Ctx } from "@/lib/auth/context";
import { fmtDate } from "@/lib/dates";
import { clientApprovalStatus } from "@/server/services/portal";
import { Section } from "@/components/page";
import { Badge } from "@/components/ui/badge";

/** Where the client's own sign-off stands, for the bureau's staff. Only shown where the client's approval is required. */
export async function ClientApprovalPanel({ ctx, runId }: { ctx: Ctx; runId: string }) {
  const s = await clientApprovalStatus(ctx, runId);
  if (!s.required) return null;
  return (
    <Section title="Client approval" description="This client signs off each payroll in its portal after the bureau's own approval. The payroll cannot be locked until they have approved its current figures.">
      {s.approvedNow && s.last ? (
        <p className="text-sm">
          <Badge tone="green">Approved</Badge> by {s.last.byName} on {fmtDate(s.last.createdAt)}.{s.last.comment ? ` Note: ${s.last.comment}` : ""}
        </p>
      ) : s.last?.decision === "REJECTED" ? (
        <p className="text-sm">
          <Badge tone="red">Sent back</Badge> by {s.last.byName} on {fmtDate(s.last.createdAt)}: {s.last.comment}
        </p>
      ) : s.awaiting ? (
        <p className="text-sm">
          <Badge tone="amber">Waiting for the client</Badge> The bureau has approved; the client has not yet.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">Not with the client yet: it goes to them once the bureau has approved it.{s.last ? " An earlier approval was for figures that have since been recalculated." : ""}</p>
      )}
    </Section>
  );
}
