import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { reconciliationsAsAt } from "@/server/services/period-close";
import { d, iso } from "@/lib/dates";
import { naira } from "@/lib/money";
import { FilterBar, FilterField, PageHeader, Section } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

const WHERE: Record<string, { href: string; text: string }> = {
  TRIAL_BALANCE: { href: "/accounting/trial-balance", text: "Trial balance" },
  AR_GL: { href: "/finance/statements", text: "Receivables ageing" },
  AP_GL: { href: "/finance/payables", text: "Payables" },
  ADVANCES_GL: { href: "/finance/receipts", text: "Client receipts" },
};

export default async function ReconciliationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePage("gl.view");
  const sp = await searchParams;
  const asAt = sp.asAt ? d(sp.asAt) : new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
  const rec = await reconciliationsAsAt(ctx, asAt);
  const allAgree = rec.lines.every((l) => l.agrees);
  return (
    <>
      <PageHeader
        title="Reconciliation centre"
        description="Each subledger against its control account in the ledger, and the trial balance, as at any date. These are the same checks a period has to pass to close, so you can see before month-end whether the books agree, and where they don't, by how much."
      />
      <FilterBar>
        <FilterField label="As at">
          <Input type="date" name="asAt" defaultValue={iso(asAt)} />
        </FilterField>
      </FilterBar>
      <p className={`mb-4 rounded-md p-3 text-sm ${allAgree ? "bg-green-50 text-green-900" : "bg-red-50 text-red-900"}`}>{allAgree ? "Everything agrees as at this date." : `${rec.lines.filter((l) => !l.agrees).length} reconciliation(s) are out as at this date. A period ending on or after it cannot close until they agree.`}</p>
      <Section title="Reconciliations" flush>
        <Table>
          <THead>
            <TR>
              <TH>Reconciliation</TH>
              <TH className="text-right">Subledger</TH>
              <TH className="text-right">Ledger</TH>
              <TH className="text-right">Difference</TH>
              <TH>Result</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {rec.lines.map((l) => (
              <TR key={l.code}>
                <TD className="max-w-[30rem] whitespace-normal">{l.label}</TD>
                <TD className="text-right">{naira(l.subledger)}</TD>
                <TD className="text-right">{naira(l.ledger)}</TD>
                <TD className="text-right">{l.difference ? naira(l.difference) : "—"}</TD>
                <TD>
                  <Badge tone={l.agrees ? "green" : "red"}>{l.agrees ? "Agrees" : "Out"}</Badge>
                </TD>
                <TD className="text-xs">
                  <Link className="text-primary underline" href={WHERE[l.code].href}>
                    {WHERE[l.code].text} →
                  </Link>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Section>
    </>
  );
}
