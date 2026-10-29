import { requirePage } from "@/lib/auth/session";
import { auditIntegrityOverview } from "@/server/services/audit-seal";
import { fmtDate } from "@/lib/dates";
import { PageHeader, Section, Stat, StatGrid } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { Badge } from "@/components/ui/badge";
import { verifyAuditNowAction } from "@/app/actions/audit-seal";

const when = (d: Date | null | undefined) => (d ? `${d.toISOString().slice(0, 16).replace("T", " ")} UTC` : "never");

export default async function AuditIntegrityPage() {
  const ctx = await requirePage("audit.view");
  const o = await auditIntegrityOverview(ctx);
  const job = (j: typeof o.jobs.seal) => (j ? <Badge tone={j.ok ? "green" : "red"}>{j.ok ? "ran" : "FAILED"} {when(j.startedAt)}</Badge> : <Badge tone="amber">never run</Badge>);
  return (
    <>
      <PageHeader
        title="Audit integrity"
        description="Every audit entry is sealed with a keyed hash that links it to the one before. If an entry is later changed, removed, added out of order or back-dated, the check names it. This detects tampering; it does not prevent it."
      />
      {!o.keyConfigured && (
        <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          AUDIT_SEAL_KEY is not set (or is too short), so the audit log is not being sealed and cannot be checked. See the launch checklist.
        </p>
      )}
      <StatGrid cols={4}>
        <Stat label="Entries sealed" value={String(o.sealed)} />
        <Stat label="Waiting to be sealed" value={String(o.unsealed)} />
        <Stat label="Sealed late (history from before sealing began)" value={String(o.sealedLate)} />
        <Stat label="Protected since" value={o.firstSealedAt ? fmtDate(o.firstSealedAt) : "not yet"} />
      </StatGrid>
      <Section title="Chain head" description="The last seal. A copy is emailed each week to the people who can view the audit log: keep those emails, they are the copy outside the system.">
        {o.head ? (
          <p className="break-all font-mono text-xs">
            Entry {o.head.seq} · {o.head.chainHash} · sealed {when(o.head.sealedAt)}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Nothing sealed yet.</p>
        )}
      </Section>
      <Section title="Scheduled jobs">
        <ul className="space-y-1 text-sm">
          <li>Sealing (every minute): {job(o.jobs.seal)}</li>
          <li>Daily check: {job(o.jobs.verify)}</li>
          <li>Weekly chain-head email: {job(o.jobs.heads)}</li>
        </ul>
      </Section>
      <Section title="Check now" description="Seals anything waiting, then checks every entry of your organization's audit log. The check itself is written to the audit log.">
        <ActionButton action={verifyAuditNowAction}>Check the audit log now</ActionButton>
      </Section>
    </>
  );
}
