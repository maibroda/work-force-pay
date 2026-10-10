import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { listReversals } from "@/server/services/journals";
import { fmtDate } from "@/lib/dates";
import { naira } from "@/lib/money";
import { Empty, PageHeader, Section, Stat, StatGrid } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { decideReversalAction } from "@/app/actions/journals";

export default async function ReversalsPage() {
  const ctx = await requirePage("gl.view");
  const rows = await listReversals(ctx);
  const approve = can(ctx.role, "journal.approve");
  const pending = rows.filter((r) => r.status === "PENDING");
  return (
    <>
      <PageHeader
        title="Journal reversals"
        description="A posted manual journal is never edited or deleted. If it was wrong, someone asks for a reversal here (from the journal's own page) with a reason and a date, and someone else approves it. Approving posts a mirror journal, with the same accounts and dimensions and debit and credit swapped, beside the original, which stays in the ledger untouched. Journals made by invoicing, payroll, payables or depreciation are corrected through their own documents instead."
      />
      <StatGrid cols={3}>
        <Stat label="Waiting for approval" value={pending.length} tone={pending.length ? "amber" : "green"} />
        <Stat label="Approved" value={rows.filter((r) => r.status === "APPROVED").length} />
        <Stat label="Turned down" value={rows.filter((r) => r.status === "REJECTED").length} />
      </StatGrid>
      <Section title="Requests" flush>
        <Table>
          <THead>
            <TR>
              <TH>Journal</TH>
              <TH>Why</TH>
              <TH>Reverse on</TH>
              <TH>Asked by</TH>
              <TH>Status</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.id}>
                <TD className="max-w-[18rem] whitespace-normal">
                  <Link className="font-mono text-xs text-primary underline" href={`/accounting/journals/${r.journal.id}`}>
                    {r.journal.entryNumber}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    {r.journal.description} · {naira(r.journal.totalDebit)}
                  </div>
                </TD>
                <TD className="max-w-[18rem] whitespace-normal text-xs">{r.reason}</TD>
                <TD className="text-xs">{fmtDate(r.reverseDate)}</TD>
                <TD className="text-xs">
                  {r.requestedBy}
                  <div className="text-muted-foreground">{fmtDate(r.createdAt)}</div>
                </TD>
                <TD className="max-w-[16rem] whitespace-normal text-xs">
                  <StatusBadge status={r.status} />
                  {r.decidedBy && (
                    <div className="mt-1 text-muted-foreground">
                      {r.decidedBy}, {fmtDate(r.decidedAt)}
                      {r.decisionNote ? ` — ${r.decisionNote}` : ""}
                    </div>
                  )}
                  {r.journal.reversedBy && <Badge tone="gray">posted as {r.journal.reversedBy.entryNumber}</Badge>}
                </TD>
                <TD className="space-x-1 whitespace-nowrap text-right">
                  {approve && r.status === "PENDING" && r.requestedByUserId !== ctx.userId && (
                    <>
                      <ActionButton action={decideReversalAction.bind(null, r.id, true)} confirm="Approve this reversal? A mirror journal will be posted on the date requested." variant="success">
                        Approve
                      </ActionButton>
                      <ActionButton action={decideReversalAction.bind(null, r.id, false)} reason reasonPlaceholder="Why it is being turned down" variant="outline">
                        Turn down
                      </ActionButton>
                    </>
                  )}
                  {r.status === "PENDING" && r.requestedByUserId === ctx.userId && <span className="text-xs text-muted-foreground">Waiting for someone else</span>}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!rows.length && <Empty>No reversals requested.</Empty>}
      </Section>
    </>
  );
}
