import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { naira, num } from "@/lib/money";
import { FormPanel, PageHeader, Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { reconcileAction } from "@/app/actions/payroll";

export default async function ReconciliationPage() {
  const ctx = await requirePage("payroll.view");
  const batches = await db.paymentBatch.findMany({
    where: { organizationId: ctx.orgId },
    include: { run: { include: { period: true } }, transactions: true },
    orderBy: { createdAt: "desc" },
  });
  return (
    <>
      <PageHeader
        title="Bank reconciliation"
        description="Match the bank statement to payment transactions on account number + amount. Unmatched lines and outstanding transactions are reported."
      />
      {can(ctx.role, "payment.manage") && batches.length > 0 && (
        <FormPanel title="Reconcile a batch against a bank statement" open>
          <SmartForm
            columns={1}
            fields={[
              {
                name: "batchId",
                label: "Payment batch",
                type: "select",
                required: true,
                options: batches.map((b) => ({
                  value: b.id,
                  label: `${b.batchNumber} — ${b.bankName} (${b.run.period.name})`,
                })),
              },
              {
                name: "csv",
                label: "Statement CSV (account_number,amount,reference)",
                type: "textarea",
                required: true,
                placeholder: "account_number,amount,reference\n1234567890,82165.64,TRF-001",
              },
            ]}
            action={reconcileAction}
            submitLabel="Reconcile"
          />
        </FormPanel>
      )}
      <Section title="Batch reconciliation status" flush>
        <Table>
          <THead>
            <TR>
              <TH>Batch</TH>
              <TH>Payroll</TH>
              <TH>Bank</TH>
              <TH className="text-right">Paid</TH>
              <TH className="text-right">Reconciled</TH>
              <TH className="text-right">Outstanding amount</TH>
              <TH>Status</TH>
            </TR>
          </THead>
          <TBody>
            {batches.map((b) => {
              const rec = b.transactions.filter((t) => t.reconciled);
              const out = b.transactions.filter((t) => !t.reconciled).reduce((a, t) => a + num(t.amount), 0);
              return (
                <TR key={b.id}>
                  <TD className="font-mono text-xs">{b.batchNumber}</TD>
                  <TD>{b.run.period.name}</TD>
                  <TD>{b.bankName}</TD>
                  <TD className="text-right">{naira(b.totalAmount)}</TD>
                  <TD className="text-right">
                    {rec.length}/{b.transactions.length}
                  </TD>
                  <TD className="text-right">{naira(out)}</TD>
                  <TD>
                    <StatusBadge status={b.status} />
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </Section>
    </>
  );
}
