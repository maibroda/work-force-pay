import { requirePage } from "@/lib/auth/session";
import { trialBalance } from "@/server/services/financial-statements";
import { fmtDate, iso } from "@/lib/dates";
import { naira } from "@/lib/money";
import { FilterBar, FilterField, PageHeader, Section, Empty } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TBody, TD, TFoot, TH, THead, TR } from "@/components/ui/table";

export default async function TrialBalancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requirePage("gl.view");
  const sp = await searchParams;
  const tb = await trialBalance(ctx, sp.asOf);

  return (
    <>
      <PageHeader
        title="Trial balance"
        description="Every GL account's debit/credit activity from posted payroll journals, as of a date. This is the one statement here that's fully GL-sourced — it always balances by construction."
      />
      <FilterBar>
        <FilterField label="As of">
          <Input type="date" name="asOf" defaultValue={sp.asOf ?? iso(new Date())} />
        </FilterField>
      </FilterBar>

      <div className="mb-4">
        <Badge tone={tb.balanced ? "green" : "red"}>
          {tb.balanced ? "Balanced" : "Out of balance — check the GL"} as of {fmtDate(tb.asOf)}
        </Badge>
      </div>

      <Section title="Accounts" flush>
        <Table>
          <THead>
            <TR>
              <TH>Code</TH>
              <TH>Account</TH>
              <TH>Type</TH>
              <TH className="text-right">Debit</TH>
              <TH className="text-right">Credit</TH>
            </TR>
          </THead>
          <TBody>
            {tb.rows.map((r) => (
              <TR key={r.account.id}>
                <TD className="font-mono text-xs">{r.account.code}</TD>
                <TD>{r.account.name}</TD>
                <TD className="text-xs text-muted-foreground">{r.account.type}</TD>
                <TD className="text-right">{r.debitBalance ? naira(r.debitBalance) : "—"}</TD>
                <TD className="text-right">{r.creditBalance ? naira(r.creditBalance) : "—"}</TD>
              </TR>
            ))}
          </TBody>
          <TFoot>
            <TR className="font-semibold">
              <TD colSpan={3}>Total</TD>
              <TD className="text-right">{naira(tb.totals.debit)}</TD>
              <TD className="text-right">{naira(tb.totals.credit)}</TD>
            </TR>
          </TFoot>
        </Table>
        {!tb.rows.length && <Empty>No journal activity yet — post a payroll run to the GL first.</Empty>}
      </Section>
    </>
  );
}
