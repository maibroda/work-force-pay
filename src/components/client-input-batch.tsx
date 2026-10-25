import type { getClientInputs } from "@/server/services/client-inputs";
import { fmtDate } from "@/lib/dates";
import { naira } from "@/lib/money";
import { INPUT_TYPE_LABELS, isDeduction, type InputType } from "@/lib/client-inputs";
import { Section } from "@/components/page";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

type Batch = Awaited<ReturnType<typeof getClientInputs>>;

/** One upload as the client sent it, with where it stands; shared by the client's portal and the bureau's review page. */
export function ClientInputBatch({ b, actions }: { b: Batch; actions?: React.ReactNode }) {
  const note = b.decisionNote;
  return (
    <>
      <Section
        title={`${b.number} — ${b.period.name}`}
        description={`Sent by ${b.submittedBy} on ${fmtDate(b.createdAt)} from ${b.fileName}. ${b.rowCount} input(s): earnings ${naira(b.earningsTotal)}, deductions ${naira(b.deductionsTotal)}.`}
        actions={actions}
      >
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <StatusBadge status={b.status} />
          {b.late && <Badge tone="amber">Sent after the cut-off</Badge>}
          {b.warningCount > 0 && <Badge tone="amber">{b.warningCount} with warnings</Badge>}
          {b.status !== "SUBMITTED" && b.decidedBy && (
            <span className="text-xs text-muted-foreground">
              {b.status === "ACCEPTED" ? "Accepted" : b.status === "REJECTED" ? "Sent back" : "Withdrawn"} by {b.decidedBy}
              {b.decidedAt ? ` on ${fmtDate(b.decidedAt)}` : ""}
            </span>
          )}
        </div>
        {b.note && <p className="mt-2 text-sm">Note from the client: {b.note}</p>}
        {note && b.status === "REJECTED" && <p className="mt-2 rounded bg-red-50 px-3 py-2 text-sm text-red-800">Sent back: {note}</p>}
        {b.blockers.map((x) => (
          <p key={x} className="mt-2 rounded bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {x}
          </p>
        ))}
      </Section>
      <Section title="What was sent" flush>
        <Table>
          <THead>
            <TR>
              <TH>Line</TH>
              <TH>Employee</TH>
              <TH>What</TH>
              <TH className="text-right">Amount</TH>
              <TH>Reference / note</TH>
              <TH>Checks</TH>
            </TR>
          </THead>
          <TBody>
            {b.rows.map((r) => (
              <TR key={r.id}>
                <TD className="font-mono text-xs">{r.line}</TD>
                <TD className="text-xs">
                  {r.employee.employeeNumber} {r.employee.firstName} {r.employee.lastName}
                </TD>
                <TD className="text-xs">
                  <Badge tone={isDeduction(r.type as InputType) ? "red" : "green"}>{INPUT_TYPE_LABELS[r.type as InputType] ?? r.type}</Badge> {r.description}
                  {!isDeduction(r.type as InputType) && !r.taxable && <span className="text-muted-foreground"> (not taxable)</span>}
                </TD>
                <TD className="text-right text-xs">{naira(r.amount)}</TD>
                <TD className="whitespace-normal text-xs">
                  {r.reference && <p>Ref: {r.reference}</p>}
                  {r.note && <p>{r.note}</p>}
                </TD>
                <TD className="whitespace-normal text-xs text-amber-700">{r.warnings.map((w, i) => <p key={i}>! {w}</p>)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Section>
    </>
  );
}
