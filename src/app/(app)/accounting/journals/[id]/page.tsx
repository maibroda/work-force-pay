import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth/session";
import { getJournal } from "@/server/services/accounting";
import { reversalStateFor } from "@/server/services/journals";
import { requestReversalAction } from "@/app/actions/journals";
import { SmartForm } from "@/components/smart-form";
import { iso } from "@/lib/dates";
import { fmtDate } from "@/lib/dates";
import { naira } from "@/lib/money";
import { DIMENSIONS } from "@/lib/dimensions";
import { KV, PageHeader, Section } from "@/components/page";
import { PrintButton } from "@/components/print-button";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TFoot, TH, THead, TR } from "@/components/ui/table";

export default async function JournalPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("gl.view");
  const { id } = await params;
  const j = await getJournal(ctx, id);
  if (!j) notFound();
  const balanced = Number(j.totalDebit) === Number(j.totalCredit);
  const rev = await reversalStateFor(ctx, id);
  return (
    <>
      <PageHeader
        title={`Journal ${j.entryNumber}`}
        crumbs={[{ href: "/accounting/journals", label: "Journal entries" }]}
        description={j.description}
        actions={<PrintButton />}
      />
      <Section title="Details">
        <KV
          cols={4}
          items={[
            ["Posting date", fmtDate(j.postingDate)],
            ["Payroll period", j.periodName ?? "—"],
            [
              "Payroll run",
              j.run ? (
                <Link key="r" className="text-primary underline" href={`/payroll/runs/${j.runId}`}>
                  #{j.run.runNumber} {j.run.type.toLowerCase()}
                </Link>
              ) : (
                "—"
              ),
            ],
            ["Accounting period", j.period?.name ?? "not stamped"],
            ["Source document", j.sourceType ? `${j.sourceType.replace(/_/g, " ").toLowerCase()} ${j.sourceId ?? ""}` : "—"],
            ["Posted by", `${j.postedBy} · ${fmtDate(j.postedAt)}`],
            ["Trigger", j.source.replace(/_/g, " ").toLowerCase()],
            [
              "Status",
              <Badge key="s" tone={balanced ? "green" : "red"}>
                {balanced ? "Balanced" : "Out of balance"}
              </Badge>,
            ],
          ]}
        />
        {j.remarks && <p className="mt-3 rounded-md bg-amber-50 p-2 text-xs text-amber-800">{j.remarks}</p>}
      </Section>
      {rev && (
        <Section title="Reversal">
          {rev.reversalOf && (
            <p className="text-sm">
              This journal reverses{" "}
              <Link className="text-primary underline" href={`/accounting/journals/${rev.reversalOf.id}`}>
                {rev.reversalOf.entryNumber}
              </Link>
              .
            </p>
          )}
          {rev.reversedBy && (
            <p className="text-sm">
              Reversed by{" "}
              <Link className="text-primary underline" href={`/accounting/journals/${rev.reversedBy.id}`}>
                {rev.reversedBy.entryNumber}
              </Link>
              . The original stays in the ledger untouched.
            </p>
          )}
          {rev.pending && (
            <p className="text-sm">
              A reversal dated {fmtDate(rev.pending.reverseDate)} was requested by {rev.pending.requestedBy} and is{" "}
              <Link className="text-primary underline" href="/accounting/reversals">
                waiting for approval
              </Link>
              : {rev.pending.reason}
            </p>
          )}
          {!rev.ok && !rev.reversedBy && !rev.reversalOf && <p className="text-sm text-muted-foreground">{rev.reason}</p>}
          {rev.canRequest && (
            <SmartForm
              columns={2}
              submitLabel="Request reversal"
              action={requestReversalAction.bind(null, id)}
              fields={[
                { name: "reason", label: "Why it needs reversing", type: "textarea", required: true, span: 2, help: "A sentence or two. It is recorded, and the approver sees it." },
                { name: "reverseDate", label: "Reverse on", type: "date", required: true, defaultValue: iso(new Date()), help: "Must be in a period that is open for posting." },
              ]}
            />
          )}
        </Section>
      )}
      <Section title="Lines" flush>
        <Table>
          <THead>
            <TR>
              <TH>Account</TH>
              <TH>Payroll head</TH>
              <TH>Narration</TH>
              <TH>Dimensions</TH>
              <TH className="text-right">Debit</TH>
              <TH className="text-right">Credit</TH>
            </TR>
          </THead>
          <TBody>
            {j.lines.map((l) => (
              <TR key={l.id}>
                <TD>
                  <span className="font-mono">{l.accountCode}</span> {l.accountName}
                </TD>
                <TD className="font-mono text-xs">{l.headCode}</TD>
                <TD className="text-xs">{l.description}</TD>
                <TD className="max-w-[18rem] whitespace-normal text-xs text-muted-foreground">
                  {(() => {
                    const v: Record<string, string | null> = {
                      clientId: l.client ? `${l.client.code} ${l.client.name}` : null,
                      contractId: l.contract ? l.contract.contractNumber : null,
                      beatId: l.beat ? `${l.beat.code} ${l.beat.name}` : null,
                      costCenterId: l.costCenter ? `${l.costCenter.code} ${l.costCenter.name}` : null,
                      departmentId: l.department ? `${l.department.code} ${l.department.name}` : null,
                      employeeId: l.employee ? `${l.employee.employeeNumber} ${l.employee.firstName} ${l.employee.lastName}` : null,
                      fixedAssetId: l.fixedAsset ? `${l.fixedAsset.assetNumber} ${l.fixedAsset.name}` : null,
                      regionId: l.region ? `${l.region.code} ${l.region.name}` : null,
                      branchId: l.branch ? `${l.branch.code} ${l.branch.name}` : null,
                      profitCentreId: l.profitCentre ? `${l.profitCentre.code} ${l.profitCentre.name}` : null,
                      projectId: l.project ? `${l.project.code} ${l.project.name}` : null,
                    };
                    const shown = DIMENSIONS.filter((d) => v[d.column]).map((d) => `${d.label}: ${v[d.column]}`);
                    return shown.length ? shown.join(" · ") : "—";
                  })()}
                </TD>
                <TD className="text-right">{Number(l.debit) ? naira(l.debit) : ""}</TD>
                <TD className="text-right">{Number(l.credit) ? naira(l.credit) : ""}</TD>
              </TR>
            ))}
          </TBody>
          <TFoot>
            <TR>
              <TD colSpan={4}>Total</TD>
              <TD className="text-right">{naira(j.totalDebit)}</TD>
              <TD className="text-right">{naira(j.totalCredit)}</TD>
            </TR>
          </TFoot>
        </Table>
      </Section>
    </>
  );
}
