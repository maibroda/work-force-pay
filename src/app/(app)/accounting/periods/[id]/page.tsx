import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { closeCentre } from "@/server/services/period-close";
import { KIND_LABELS, type CloseCheck } from "@/lib/period-close";
import { PERIOD_STATUS_LABELS, type PeriodStatus } from "@/lib/fiscal";
import { fmtDate } from "@/lib/dates";
import { naira } from "@/lib/money";
import { PageHeader, Section } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { setCloseChecklistRequiredAction, signOffAction, waiveCheckAction } from "@/app/actions/period-close";

const statusTone = { PASS: "green", FAIL: "red", WARN: "amber" } as const;

export default async function ClosePeriodPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("gl.view");
  const { id } = await params;
  const c = await closeCentre(ctx, id).catch(() => null);
  if (!c) notFound();
  const status = c.period.status as PeriodStatus;
  const signoffs = c.checklist;
  const open = status === "OPEN" || status === "SOFT_CLOSED";
  const canSign = can(ctx.role, "period.close") && open;
  const canWaive = can(ctx.role, "period.approve") && open;
  const blocked = c.blockers.length > 0;
  const rows = c.checks.filter((x) => !x.code.startsWith("SIGNOFF_"));
  return (
    <>
      <PageHeader
        title={`Closing ${c.period.name}`}
        crumbs={[{ href: "/accounting/periods", label: "Accounting periods" }]}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={status === "OPEN" ? "green" : status === "SOFT_CLOSED" ? "amber" : "gray"}>{PERIOD_STATUS_LABELS[status]}</Badge>
            {c.period.fiscalYear.name} · {fmtDate(c.period.startDate)} to {fmtDate(c.period.endDate)}
            <Link className="text-primary underline" href={`/accounting/ar-report?periodId=${c.period.id}`}>
              Receivables report →
            </Link>
          </span>
        }
      />

      {open && (
        <p className={`mb-4 rounded-md p-3 text-sm ${blocked ? "bg-red-50 text-red-900" : "bg-green-50 text-green-900"}`}>
          {blocked
            ? `${c.blockers.length} thing${c.blockers.length === 1 ? "" : "s"} stand in the way of closing this period: ${c.blockers.map((b) => b.label.toLowerCase()).join("; ")}.`
            : "Nothing stands in the way. Soft close and close it from the Accounting periods page; closing writes the snapshot of the books."}
        </p>
      )}

      <Section title="The books against their control accounts (as at the last day of the period)" description="These have to agree to close the period. No one can close over a difference: put it right first." flush>
        <Table>
          <THead>
            <TR>
              <TH>Reconciliation</TH>
              <TH className="text-right">Subledger</TH>
              <TH className="text-right">Ledger</TH>
              <TH className="text-right">Difference</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {c.reconciliations.map((r) => (
              <TR key={r.code}>
                <TD className="max-w-[28rem] whitespace-normal">{r.label}</TD>
                <TD className="text-right">{naira(r.subledger)}</TD>
                <TD className="text-right">{naira(r.ledger)}</TD>
                <TD className="text-right">{r.difference ? naira(r.difference) : "—"}</TD>
                <TD>
                  <Badge tone={r.agrees ? "green" : "red"}>{r.agrees ? "Agrees" : "Out"}</Badge>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Section>

      <Section title="Checks" flush>
        <Table>
          <THead>
            <TR>
              <TH>Check</TH>
              <TH>Kind</TH>
              <TH>Result</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {rows
              .filter((x) => x.kind !== "HARD")
              .map((x: CloseCheck) => (
                <TR key={x.code}>
                  <TD className="max-w-[18rem] whitespace-normal font-medium">{x.label}</TD>
                  <TD className="max-w-[16rem] whitespace-normal text-xs text-muted-foreground">{KIND_LABELS[x.kind]}</TD>
                  <TD className="max-w-[26rem] whitespace-normal text-xs">
                    <Badge tone={x.waived ? "gray" : statusTone[x.status]}>{x.waived ? "Closed over" : x.status === "PASS" ? "Clear" : x.status === "FAIL" ? "Outstanding" : "Note"}</Badge>
                    <div className="mt-1">{x.detail}</div>
                  </TD>
                  <TD className="text-right">
                    {canWaive && x.kind === "PENDING" && x.status === "FAIL" && !x.waived && (
                      <ActionButton action={waiveCheckAction.bind(null, c.period.id, x.code)} reason reasonPlaceholder="Why the period can close over this (a sentence or two; it is recorded)" variant="outline">
                        Close over this
                      </ActionButton>
                    )}
                  </TD>
                </TR>
              ))}
          </TBody>
        </Table>
        {c.waivers.length > 0 && (
          <div className="border-t px-4 py-3 text-xs text-muted-foreground">
            <p className="mb-1 font-medium">Closed over (kept for good)</p>
            {c.waivers.map((w) => (
              <p key={w.id}>
                {fmtDate(w.createdAt)}, {w.waivedBy}: {rows.find((x) => x.code === w.checkCode)?.label ?? w.checkCode} — {w.reason}
              </p>
            ))}
          </div>
        )}
      </Section>

      <Section
        title="Sign-offs"
        description={c.checklistRequired ? "Every sign-off is needed before this period can close." : "Recorded for the file. They don't stop the period closing unless the organization makes them compulsory."}
        flush
      >
        <Table>
          <THead>
            <TR>
              <TH>Item</TH>
              <TH>Signed off</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {signoffs.map((s) => (
              <TR key={s.id}>
                <TD>{s.label}</TD>
                <TD className="text-xs">{s.done ? `${s.doneBy}, ${fmtDate(s.doneAt)}${s.note ? ` — ${s.note}` : ""}` : "—"}</TD>
                <TD className="text-right">
                  {canSign &&
                    (s.done ? (
                      <ActionButton action={signOffAction.bind(null, c.period.id, s.code, false)} reason reasonPlaceholder="Why the sign-off is being taken back" variant="outline">
                        Take back
                      </ActionButton>
                    ) : (
                      <ActionButton action={signOffAction.bind(null, c.period.id, s.code, true)} variant="outline">
                        Sign off
                      </ActionButton>
                    ))}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {can(ctx.role, "period.approve") && (
          <div className="border-t px-4 py-3">
            <ActionButton action={setCloseChecklistRequiredAction.bind(null, !c.checklistRequired)} confirm={c.checklistRequired ? "Make sign-offs advisory again?" : "Make every sign-off compulsory before a period can close?"} variant="outline">
              {c.checklistRequired ? "Make sign-offs advisory" : "Make sign-offs compulsory"}
            </ActionButton>
          </div>
        )}
      </Section>

      <Section title="Snapshots" description="The official record of the books when the period closed. Each is kept; a reopened period's snapshot is marked superseded." flush>
        <Table>
          <THead>
            <TR>
              <TH>Version</TH>
              <TH>Taken</TH>
              <TH className="text-right">Receivables</TH>
              <TH className="text-right">Payables</TH>
              <TH>Status</TH>
              <TH>Checksum</TH>
            </TR>
          </THead>
          <TBody>
            {c.snapshots.map((s) => (
              <TR key={s.id}>
                <TD>v{s.version}</TD>
                <TD className="text-xs">
                  {fmtDate(s.takenAt)} by {s.takenBy}
                </TD>
                <TD className="text-right">{naira(Number(s.arTotal))}</TD>
                <TD className="text-right">{naira(Number(s.apTotal))}</TD>
                <TD>{s.supersededAt ? <Badge tone="gray">Superseded</Badge> : <Badge tone="green">Official</Badge>}</TD>
                <TD className="font-mono text-[10px]">{s.checksum.slice(0, 16)}…</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!c.snapshots.length && <p className="px-4 py-3 text-sm text-muted-foreground">No snapshot yet: one is written when the period closes.</p>}
      </Section>
    </>
  );
}
