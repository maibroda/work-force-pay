import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { proformaForRun } from "@/server/services/billing";
import { db } from "@/lib/db";
import { fmtDate } from "@/lib/dates";
import { naira } from "@/lib/money";
import { Empty, FilterBar, FilterField, PageHeader, Section } from "@/components/page";
import { PrintButton } from "@/components/print-button";
import { Select } from "@/components/ui/input";
import { Table, TBody, TD, TFoot, TH, THead, TR } from "@/components/ui/table";

export default async function ProformaPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePage("client.view");
  const sp = await searchParams;
  const runs = await db.payrollRun.findMany({
    where: { organizationId: ctx.orgId, status: { in: ["CALCULATED", "PENDING_APPROVAL", "APPROVED", "LOCKED", "PAID"] } },
    include: { period: { select: { name: true, year: true, month: true } } },
    orderBy: [{ period: { year: "desc" } }, { period: { month: "desc" } }, { runNumber: "desc" }],
    take: 40,
  });
  const result = sp.runId ? await proformaForRun(ctx, sp.runId).then((p) => ({ ok: true as const, p })).catch((e: Error) => ({ ok: false as const, error: e.message })) : null;
  return (
    <>
      <PageHeader
        title="Proforma invoices"
        description="What each client would be invoiced for a payroll run, worked out exactly as the invoice will be (each contract under its billing rule, the tax at the rates in force on the invoice date) but before the payroll is locked. Nothing is saved, numbered or posted, and it is not a tax invoice: use it to show a client what to expect."
      />
      <FilterBar>
        <FilterField label="Payroll run">
          <Select name="runId" defaultValue={sp.runId ?? ""}>
            <option value="">— Choose a run —</option>
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.period.name} #{r.runNumber} ({r.status.toLowerCase().replace("_", " ")})
              </option>
            ))}
          </Select>
        </FilterField>
      </FilterBar>
      {result && !result.ok && <Empty>{result.error}</Empty>}
      {result?.ok && (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">
              {result.p.run.period.name}, run #{result.p.run.runNumber} (payroll {result.p.runStatus.toLowerCase().replace("_", " ")}). Invoice date {fmtDate(result.p.invoiceDate)}, due {fmtDate(result.p.dueDate)}.
              {result.p.alreadyInvoiced ? " This run has already been invoiced; see Billing & receivables." : ""}
            </span>
            <PrintButton />
          </div>
          {result.p.plans.map((p) => (
            <Section key={p.clientId} title={`PROFORMA — ${p.clientName}`} description="Not a tax invoice. Subject to the payroll being locked." flush>
              <Table>
                <THead>
                  <TR>
                    <TH>Description</TH>
                    <TH className="text-right">Headcount</TH>
                    <TH className="text-right">Direct charge</TH>
                    <TH className="text-right">Indirect charge</TH>
                    <TH className="text-right">Amount</TH>
                  </TR>
                </THead>
                <TBody>
                  {p.lines.map((l) => (
                    <TR key={l.sortOrder}>
                      <TD>{l.description}</TD>
                      <TD className="text-right">{l.headcount}</TD>
                      <TD className="text-right">{naira(l.directCharge)}</TD>
                      <TD className="text-right">{naira(l.indirectCharge)}</TD>
                      <TD className="text-right">{naira(l.amount)}</TD>
                    </TR>
                  ))}
                </TBody>
                <TFoot>
                  <TR>
                    <TD colSpan={4}>Subtotal</TD>
                    <TD className="text-right">{naira(p.subtotal)}</TD>
                  </TR>
                  {p.vatAmount > 0 && (
                    <TR>
                      <TD colSpan={4}>VAT ({p.vatPct}%)</TD>
                      <TD className="text-right">{naira(p.vatAmount)}</TD>
                    </TR>
                  )}
                  <TR className="font-semibold">
                    <TD colSpan={4}>Total expected</TD>
                    <TD className="text-right">{naira(p.totalAmount)}</TD>
                  </TR>
                </TFoot>
              </Table>
            </Section>
          ))}
          <p className="text-xs text-muted-foreground">
            Total across clients: {naira(result.p.plans.reduce((s, p) => s + p.totalAmount, 0))}.{" "}
            <Link className="text-primary underline" href="/finance/invoices">
              Billing &amp; receivables →
            </Link>
          </p>
        </>
      )}
      {!result && <Empty>Choose a payroll run to see its proforma.</Empty>}
    </>
  );
}
