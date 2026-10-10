import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { approvalRequired, listDocuments } from "@/server/services/journals";
import { db } from "@/lib/db";
import { KIND_LABELS, STATUS_LABELS, type DocumentStatus, type JournalKind } from "@/lib/journals";
import { fmtDate } from "@/lib/dates";
import { naira } from "@/lib/money";
import { Empty, FilterBar, FilterField, PageHeader, Section, Stat, StatGrid } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { runDueReversalsAction, setApprovalRequiredAction } from "@/app/actions/journals";

const tone: Record<DocumentStatus, "gray" | "amber" | "blue" | "green" | "red"> = { DRAFT: "gray", SUBMITTED: "amber", APPROVED: "blue", POSTED: "green", REJECTED: "red", CANCELLED: "gray" };

export default async function ManualJournalsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePage("gl.view");
  const sp = await searchParams;
  const [all, required] = await Promise.all([listDocuments(ctx), approvalRequired(db, ctx.orgId)]);
  const rows = sp.status ? all.filter((r) => r.status === sp.status) : all;
  const count = (s: DocumentStatus) => all.filter((r) => r.status === s).length;
  const manage = can(ctx.role, "journal.manage");
  const approve = can(ctx.role, "journal.approve");
  const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
  const dueAccruals = all.filter((r) => r.kind === "ACCRUAL" && r.status === "POSTED" && r.reverseOn && r.reverseOn <= today && r.journal && !r.journal.reversedBy);

  return (
    <>
      <PageHeader
        title="Manual journals"
        description={`Entries that no other part of the system posts. A journal is drafted, submitted, approved by someone other than whoever prepared it, then posted; nothing reaches the ledger until it is posted. After submission its lines can't be changed. A posted journal is never edited: a reversal is requested and approved instead (Journal Reversals). Approval is ${required ? "required" : "switched off"} for this organization. Receivables and payables are control accounts and can't be posted to by hand.`}
        actions={
          manage ? (
            <Link href="/accounting/manual-journals/new" className={buttonVariants({})}>
              New journal
            </Link>
          ) : undefined
        }
      />
      <StatGrid cols={4}>
        <Stat label="Drafts" value={count("DRAFT") + count("REJECTED")} />
        <Stat label="Waiting for approval" value={count("SUBMITTED")} tone={count("SUBMITTED") ? "amber" : "green"} />
        <Stat label="Approved, not posted" value={count("APPROVED")} tone={count("APPROVED") ? "amber" : "green"} />
        <Stat label="Accrual reversals due" value={dueAccruals.length} tone={dueAccruals.length ? "amber" : "green"} />
      </StatGrid>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        {approve && (
          <ActionButton action={runDueReversalsAction} confirm="Post the automatic reversal of every accrual whose date has come?" variant="outline">
            Post due accrual reversals
          </ActionButton>
        )}
        {can(ctx.role, "period.approve") && (
          <ActionButton
            action={setApprovalRequiredAction.bind(null, !required)}
            confirm={required ? "Switch approval off? The person who prepares a journal will be able to post it themselves. This is recorded." : "Switch approval back on?"}
            variant="outline"
          >
            {required ? "Switch approval off" : "Require approval"}
          </ActionButton>
        )}
      </div>

      <FilterBar>
        <FilterField label="Status">
          <Select name="status" defaultValue={sp.status ?? ""}>
            <option value="">All</option>
            {(Object.keys(STATUS_LABELS) as DocumentStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </FilterField>
      </FilterBar>

      <Section title={`${rows.length} journal${rows.length === 1 ? "" : "s"}`} flush>
        <Table>
          <THead>
            <TR>
              <TH>Number</TH>
              <TH>What it is for</TH>
              <TH>Kind</TH>
              <TH>Posting date</TH>
              <TH className="text-right">Amount</TH>
              <TH>Status</TH>
              <TH>Prepared by</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.id}>
                <TD className="font-mono text-xs">
                  <Link className="text-primary underline" href={`/accounting/manual-journals/${r.id}`}>
                    {r.documentNumber}
                  </Link>
                </TD>
                <TD className="max-w-[22rem] whitespace-normal">{r.description}</TD>
                <TD className="text-xs">
                  {KIND_LABELS[r.kind as JournalKind]}
                  {r.reverseOn && <div className="text-muted-foreground">reverses {fmtDate(r.reverseOn)}</div>}
                </TD>
                <TD className="text-xs">{fmtDate(r.postingDate)}</TD>
                <TD className="text-right">{naira(r.total)}</TD>
                <TD>
                  <Badge tone={tone[r.status as DocumentStatus]}>{STATUS_LABELS[r.status as DocumentStatus]}</Badge>
                  {r.journal && <div className="text-xs text-muted-foreground">{r.journal.entryNumber}{r.journal.reversedBy ? ` · reversed by ${r.journal.reversedBy.entryNumber}` : ""}</div>}
                </TD>
                <TD className="text-xs">{r.createdBy}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!rows.length && <Empty>No journals{sp.status ? " with that status" : " yet"}.</Empty>}
      </Section>
    </>
  );
}
