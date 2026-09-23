import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { listBatches } from "@/server/services/payments";
import { listRuns } from "@/server/services/payroll";
import { naira } from "@/lib/money";
import { PageHeader, Section, Empty } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { createBatchesAction, markBatchPaidAction } from "@/app/actions/payroll";

export default async function BatchesPage() {
  const ctx = await requirePage("payroll.view");
  const [batches, runs] = await Promise.all([listBatches(ctx), listRuns(ctx)]);
  const withBatches = new Set(batches.map((b) => b.runId));
  const ready = runs.filter((r) => r.status === "LOCKED" && !withBatches.has(r.id));
  const manage = can(ctx.role, "payment.manage");
  return (
    <>
      <PageHeader
        title="Payment batches"
        description="One batch per bank from a locked payroll. Mark a batch paid once the bank confirms; the run and period move to PAID when every batch is paid."
      />
      {ready.length > 0 && (
        <Section title="Locked runs ready for payment">
          <div className="flex flex-wrap gap-2">
            {ready.map((r) => (
              <span key={r.id} className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
                {r.period.name} #{r.runNumber} — {naira(r.totalNet)}{" "}
                {manage && (
                  <ActionButton action={createBatchesAction.bind(null, r.id)}>Create batches</ActionButton>
                )}
              </span>
            ))}
          </div>
        </Section>
      )}
      <Section title="Batches" flush>
        <Table>
          <THead>
            <TR>
              <TH>Batch</TH>
              <TH>Payroll</TH>
              <TH>Bank</TH>
              <TH className="text-right">Transactions</TH>
              <TH className="text-right">Total</TH>
              <TH>Created by</TH>
              <TH>Status</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {batches.map((b) => (
              <TR key={b.id}>
                <TD className="font-mono text-xs">
                  <Link className="text-primary underline" href={`/payments/transactions?batchId=${b.id}`}>
                    {b.batchNumber}
                  </Link>
                </TD>
                <TD>
                  {b.run.period.name} #{b.run.runNumber}
                </TD>
                <TD>{b.bankName}</TD>
                <TD className="text-right">{b._count.transactions}</TD>
                <TD className="text-right">{naira(b.totalAmount)}</TD>
                <TD className="text-xs">{b.createdBy}</TD>
                <TD>
                  <StatusBadge status={b.status} />
                </TD>
                <TD>
                  {manage && b.status !== "PAID" && (
                    <ActionButton
                      action={markBatchPaidAction.bind(null, b.id)}
                      confirm="Bank confirmed?"
                      variant="success"
                    >
                      Mark paid
                    </ActionButton>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!batches.length && <Empty>No payment batches yet — lock a payroll first.</Empty>}
      </Section>
    </>
  );
}
