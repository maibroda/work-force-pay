import { requirePage } from "@/lib/auth/session";
import { listBatches, listTransactions } from "@/server/services/payments";
import { naira } from "@/lib/money";
import { fullName } from "@/lib/utils";
import { FilterBar, FilterField, PageHeader, Section, Empty } from "@/components/page";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Select } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requirePage("payroll.view");
  const sp = await searchParams;
  const [batches, txns] = await Promise.all([listBatches(ctx), listTransactions(ctx, sp.batchId)]);
  return (
    <>
      <PageHeader title="Payment transactions" />
      <FilterBar>
        <FilterField label="Batch">
          <Select name="batchId" defaultValue={sp.batchId ?? ""}>
            <option value="">All</option>
            {batches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.batchNumber} — {b.bankName} ({b.run.period.name})
              </option>
            ))}
          </Select>
        </FilterField>
      </FilterBar>
      <Section title={`${txns.length} transaction(s)`} flush>
        <Table>
          <THead>
            <TR>
              <TH>Batch</TH>
              <TH>Employee</TH>
              <TH>Bank</TH>
              <TH>Account</TH>
              <TH>Account name</TH>
              <TH className="text-right">Amount</TH>
              <TH>Bank ref.</TH>
              <TH>Status</TH>
              <TH>Reconciled</TH>
            </TR>
          </THead>
          <TBody>
            {txns.map((t) => (
              <TR key={t.id}>
                <TD className="font-mono text-xs">{t.batch.batchNumber}</TD>
                <TD>
                  {t.employee.employeeNumber} — {fullName(t.employee)}
                </TD>
                <TD>{t.bankName ?? "—"}</TD>
                <TD className="font-mono text-xs">{t.accountNumber ?? <Badge tone="red">missing</Badge>}</TD>
                <TD className="text-xs">{t.accountName ?? "—"}</TD>
                <TD className="text-right">{naira(t.amount)}</TD>
                <TD className="font-mono text-xs">{t.bankReference ?? "—"}</TD>
                <TD>
                  <StatusBadge status={t.status} />
                </TD>
                <TD>{t.reconciled ? <Badge tone="green">Yes</Badge> : <Badge>No</Badge>}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!txns.length && <Empty>No transactions.</Empty>}
      </Section>
    </>
  );
}
