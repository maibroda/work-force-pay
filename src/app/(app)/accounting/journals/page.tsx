import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { listJournals, unpostedRuns } from "@/server/services/accounting";
import { fmtDate } from "@/lib/dates";
import { naira } from "@/lib/money";
import { Empty, PageHeader, Section } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { postRunToGlAction } from "@/app/actions/accounting";

const SOURCE: Record<string, string> = {
  PAYROLL_LOCK: "Payroll locked",
  PAYROLL_CLOSE: "Period closed",
  MANUAL_POST: "Posted manually",
  AR_INVOICE: "Client invoice",
  AR_RECEIPT: "Client receipt",
  AR_DEDUCTION: "Client deduction",
  AP_INVOICE: "Vendor bill",
  AP_PAYMENT: "Vendor payment",
  AP_DEDUCTION: "Vendor deduction",
  DEPRECIATION: "Depreciation",
  BANK_ACCOUNT_OPENING: "Bank account opening balance",
  FIXED_ASSET_ACQUISITION: "Fixed asset acquired",
  FIXED_ASSET_DISPOSAL: "Fixed asset disposed",
};

export default async function JournalsPage() {
  const ctx = await requirePage("gl.view");
  const [journals, unposted] = await Promise.all([listJournals(ctx), unpostedRuns(ctx)]);
  const manage = can(ctx.role, "gl.manage");
  return (
    <>
      <PageHeader
        title="Journal entries"
        description="Every balanced journal posted to the general ledger — payroll (posted automatically at lock/close), client billing and vendor billing (posted automatically on each invoice, receipt, payment and deduction), and fixed-asset depreciation (posted manually per period)."
      />
      {unposted.length > 0 && (
        <Section
          title={`${unposted.length} locked payroll(s) not yet posted`}
          description="These were locked before general-ledger posting existed, or posting failed. Post them to bring the ledger up to date."
        >
          <ul className="divide-y text-sm">
            {unposted.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 py-2">
                <span>
                  {r.period.name} — {r.type === "REGULAR" ? "regular run" : `supplementary #${r.runNumber}`}{" "}
                  <span className="text-muted-foreground">(net {naira(r.totalNet)})</span>
                </span>
                {manage ? (
                  <ActionButton action={postRunToGlAction.bind(null, r.id)}>Post to GL</ActionButton>
                ) : (
                  <Badge tone="amber">Awaiting posting</Badge>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Section title={`${journals.length} journal(s)`} flush>
        {journals.length ? (
          <Table>
            <THead>
              <TR>
                <TH>Journal</TH>
                <TH>Posting date</TH>
                <TH>Description</TH>
                <TH>Trigger</TH>
                <TH className="text-right">Debit</TH>
                <TH className="text-right">Credit</TH>
                <TH>Posted by</TH>
              </TR>
            </THead>
            <TBody>
              {journals.map((j) => (
                <TR key={j.id}>
                  <TD>
                    <Link className="font-mono text-primary underline" href={`/accounting/journals/${j.id}`}>
                      {j.entryNumber}
                    </Link>
                  </TD>
                  <TD>{fmtDate(j.postingDate)}</TD>
                  <TD>{j.description}</TD>
                  <TD className="text-xs">{SOURCE[j.source] ?? j.source}</TD>
                  <TD className="text-right">{naira(j.totalDebit)}</TD>
                  <TD className="text-right">{naira(j.totalCredit)}</TD>
                  <TD className="text-xs">{j.postedBy}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <Empty>No journals posted yet. They appear here automatically when a payroll is locked.</Empty>
        )}
      </Section>
    </>
  );
}
