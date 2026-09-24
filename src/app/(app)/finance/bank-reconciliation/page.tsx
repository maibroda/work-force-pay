import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { listBankAccounts, reconciliationSummary } from "@/server/services/bank-reconciliation";
import { fmtDate, iso } from "@/lib/dates";
import { naira, num } from "@/lib/money";
import { FilterBar, FilterField, FormPanel, PageHeader, Section, Stat, StatGrid, Empty } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { ActionButton } from "@/components/action-button";
import { Badge } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { buttonVariants } from "@/components/ui/button";
import {
  autoMatchStatementLinesAction,
  importStatementLinesAction,
  manualMatchStatementLineAction,
  markStatementLineManualAction,
  unmatchStatementLineAction,
} from "@/app/actions/bank-reconciliation";

export default async function BankReconciliationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requirePage("gl.view");
  const sp = await searchParams;
  const manage = can(ctx.role, "payment.manage");
  const accounts = await listBankAccounts(ctx);
  const active = accounts.filter((a) => a.active);
  const acctId = sp.account && accounts.some((a) => a.id === sp.account) ? sp.account : active[0]?.id;

  if (!acctId) {
    return (
      <>
        <PageHeader title="Bank reconciliation" description="Reconcile the organization's operating account against imported bank statements." />
        <Empty>
          No bank accounts yet.{" "}
          <Link href="/finance/bank-accounts" className="text-primary underline">
            Add one
          </Link>{" "}
          to get started.
        </Empty>
      </>
    );
  }

  const summary = await reconciliationSummary(ctx, acctId, sp.asOf);

  return (
    <>
      <PageHeader
        title={`Bank reconciliation — ${summary.bankAccount.name}`}
        description="Statement lines are auto-matched against client receipts and vendor payments by amount and date; anything left over needs a manual match or a note."
        actions={
          <Link className={buttonVariants({ variant: "outline" })} href="/finance/bank-accounts">
            Manage accounts
          </Link>
        }
      />

      {accounts.length > 1 && (
        <FilterBar>
          <FilterField label="Bank account">
            <Select name="account" defaultValue={acctId}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.bankName})
                </option>
              ))}
            </Select>
          </FilterField>
          <FilterField label="As of">
            <Input type="date" name="asOf" defaultValue={sp.asOf ?? iso(new Date())} />
          </FilterField>
        </FilterBar>
      )}

      <StatGrid cols={5}>
        <Stat label="Balance per statement" value={naira(summary.statementBalance)} />
        <Stat label="Balance per books" value={naira(summary.bookBalance)} />
        <Stat label="Adjusted bank balance" value={naira(summary.adjustedBankBalance)} tone="green" />
        <Stat label="Adjusted book balance" value={naira(summary.adjustedBookBalance)} tone="green" />
        <Stat
          label="Difference"
          value={naira(summary.difference)}
          tone={Math.abs(summary.difference) < 0.01 ? "green" : "red"}
        />
      </StatGrid>

      <div className="mb-4">
        {summary.fullyReconciled ? (
          <Badge tone="green">Fully reconciled as of {fmtDate(summary.asOf)}</Badge>
        ) : (
          <Badge tone="amber">
            {summary.unmatchedLines.length} unmatched line(s) need review before this reconciles cleanly.
          </Badge>
        )}
      </div>

      {manage && (
        <FormPanel title="Import a bank statement">
          <SmartForm
            columns={1}
            resetOnSuccess
            action={importStatementLinesAction}
            submitLabel="Import & auto-match"
            fields={[
              { name: "bankAccountId", label: "", type: "hidden", defaultValue: acctId },
              {
                name: "csv",
                label: "Statement CSV (date,description,amount,reference)",
                type: "textarea",
                required: true,
                placeholder: "date,description,amount,reference\n2026-09-05,ABC Bank Ltd transfer,1250000.00,TRF-8821\n2026-09-06,Uniform World Ltd,-340000.00,CHQ-102",
              },
            ]}
          />
        </FormPanel>
      )}

      <Section title="Statement lines" flush>
        <Table>
          <THead>
            <TR>
              <TH>Date</TH>
              <TH>Description</TH>
              <TH className="text-right">Amount</TH>
              <TH>Reference</TH>
              <TH>Match</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {summary.lines.map((l) => (
              <TR key={l.id}>
                <TD className="text-xs">{fmtDate(l.date)}</TD>
                <TD className="max-w-xs truncate text-xs">{l.description}</TD>
                <TD className={`text-right ${num(l.amount) < 0 ? "text-red-700" : ""}`}>{naira(l.amount)}</TD>
                <TD className="text-xs">{l.reference ?? "—"}</TD>
                <TD className="text-xs">
                  {l.matchType === "CLIENT_RECEIPT" && l.matchedClientReceipt && (
                    <Badge tone="blue">Receipt — {l.matchedClientReceipt.client.name}</Badge>
                  )}
                  {l.matchType === "VENDOR_PAYMENT" && l.matchedVendorPayment && (
                    <Badge tone="blue">Payment — {l.matchedVendorPayment.vendor.name}</Badge>
                  )}
                  {l.matchType === "MANUAL" && <Badge tone="amber">Bank-only: {l.matchNote}</Badge>}
                  {!l.matchType && <Badge tone="red">Unmatched</Badge>}
                </TD>
                <TD>
                  {manage && l.matchType && (
                    <ActionButton
                      action={unmatchStatementLineAction.bind(null, l.id)}
                      confirm="Remove this match?"
                      variant="outline"
                    >
                      Unmatch
                    </ActionButton>
                  )}
                  {manage && !l.matchType && (
                    <ActionButton
                      action={markStatementLineManualAction.bind(null, l.id)}
                      reason
                      reasonPlaceholder="Bank charge, interest, transfer…"
                      variant="outline"
                    >
                      Mark bank-only
                    </ActionButton>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!summary.lines.length && <Empty>No statement lines imported yet.</Empty>}
      </Section>

      {manage && summary.unmatchedLines.some((l) => num(l.amount) > 0) && summary.outstandingReceipts.length > 0 && (
        <FormPanel title="Manually match a line to a client receipt">
          <SmartForm
            columns={2}
            resetOnSuccess
            action={manualMatchStatementLineAction}
            submitLabel="Match"
            fields={[
              { name: "kind", label: "", type: "hidden", defaultValue: "CLIENT_RECEIPT" },
              {
                name: "lineId",
                label: "Statement line",
                type: "select",
                required: true,
                options: summary.unmatchedLines
                  .filter((l) => num(l.amount) > 0)
                  .map((l) => ({ value: l.id, label: `${fmtDate(l.date)} — ${l.description} — ${naira(l.amount)}` })),
              },
              {
                name: "targetId",
                label: "Client receipt",
                type: "select",
                required: true,
                options: summary.outstandingReceipts.map((r) => ({
                  value: r.id,
                  label: `${fmtDate(r.receivedDate)} — ${r.client.name} — ${naira(r.amount)}`,
                })),
              },
            ]}
          />
        </FormPanel>
      )}

      {manage && summary.unmatchedLines.some((l) => num(l.amount) < 0) && summary.outstandingPayments.length > 0 && (
        <FormPanel title="Manually match a line to a vendor payment">
          <SmartForm
            columns={2}
            resetOnSuccess
            action={manualMatchStatementLineAction}
            submitLabel="Match"
            fields={[
              { name: "kind", label: "", type: "hidden", defaultValue: "VENDOR_PAYMENT" },
              {
                name: "lineId",
                label: "Statement line",
                type: "select",
                required: true,
                options: summary.unmatchedLines
                  .filter((l) => num(l.amount) < 0)
                  .map((l) => ({ value: l.id, label: `${fmtDate(l.date)} — ${l.description} — ${naira(l.amount)}` })),
              },
              {
                name: "targetId",
                label: "Vendor payment",
                type: "select",
                required: true,
                options: summary.outstandingPayments.map((p) => ({
                  value: p.id,
                  label: `${fmtDate(p.paidDate)} — ${p.vendor.name} — ${naira(p.amount)}`,
                })),
              },
            ]}
          />
        </FormPanel>
      )}

      {manage && summary.unmatchedLines.length > 0 && (
        <div className="mb-4">
          <ActionButton action={autoMatchStatementLinesAction.bind(null, acctId)} variant="outline">
            Re-run auto-match
          </ActionButton>
        </div>
      )}

      <Section
        title="Outstanding receipts"
        flush
        description="Recorded in the books, not yet cleared on this statement (deposits in transit)."
      >
        <Table>
          <THead>
            <TR>
              <TH>Date</TH>
              <TH>Client</TH>
              <TH className="text-right">Amount</TH>
            </TR>
          </THead>
          <TBody>
            {summary.outstandingReceipts.map((r) => (
              <TR key={r.id}>
                <TD className="text-xs">{fmtDate(r.receivedDate)}</TD>
                <TD>{r.client.name}</TD>
                <TD className="text-right">{naira(r.amount)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!summary.outstandingReceipts.length && <Empty>None — every receipt has cleared the bank.</Empty>}
      </Section>

      <Section
        title="Outstanding payments"
        flush
        description="Recorded in the books, not yet cleared on this statement."
      >
        <Table>
          <THead>
            <TR>
              <TH>Date</TH>
              <TH>Vendor</TH>
              <TH className="text-right">Amount</TH>
            </TR>
          </THead>
          <TBody>
            {summary.outstandingPayments.map((p) => (
              <TR key={p.id}>
                <TD className="text-xs">{fmtDate(p.paidDate)}</TD>
                <TD>{p.vendor.name}</TD>
                <TD className="text-right">{naira(p.amount)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!summary.outstandingPayments.length && <Empty>None — every payment has cleared the bank.</Empty>}
      </Section>
    </>
  );
}
