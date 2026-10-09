import { requirePage } from "@/lib/auth/session";
import { ledgerByDimension } from "@/server/services/dimensions";
import { DIMENSIONS } from "@/lib/dimensions";
import { naira } from "@/lib/money";
import { FilterBar, FilterField, PageHeader, Section, Stat, StatGrid } from "@/components/page";
import { Input, Select } from "@/components/ui/input";
import { Table, TBody, TD, TFoot, TH, THead, TR } from "@/components/ui/table";

export default async function LedgerByDimensionPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePage("gl.view");
  const sp = await searchParams;
  const dimension = DIMENSIONS.some((d) => d.key === sp.dimension) ? sp.dimension! : "CLIENT";
  const r = await ledgerByDimension(ctx, { dimension, from: sp.from, to: sp.to });
  const analysed = r.rows.filter((x) => x.id !== null);
  const share = r.totals.income ? Math.round((analysed.reduce((a, x) => a + x.income, 0) / r.totals.income) * 1000) / 10 : null;
  return (
    <>
      <PageHeader
        title="Ledger by dimension"
        description="Income, expense and net result, straight from the general ledger, split by who or what each line was posted for. The rows always add up to the whole ledger for the dates chosen, so the totals equal the trial balance's income and expense. Lines posted without the dimension (older postings, or kinds of posting that don't carry it yet) appear as one 'not analysed' row."
      />
      <FilterBar>
        <FilterField label="Split by">
          <Select name="dimension" defaultValue={dimension}>
            {DIMENSIONS.map((d) => (
              <option key={d.key} value={d.key}>
                {d.label}
              </option>
            ))}
          </Select>
        </FilterField>
        <FilterField label="From">
          <Input type="date" name="from" defaultValue={sp.from} />
        </FilterField>
        <FilterField label="To">
          <Input type="date" name="to" defaultValue={sp.to} />
        </FilterField>
      </FilterBar>
      <StatGrid cols={4}>
        <Stat label="Income" value={naira(r.totals.income)} />
        <Stat label="Expense" value={naira(r.totals.expense)} />
        <Stat label="Net result" value={naira(r.totals.net)} tone={r.totals.net < 0 ? "red" : "green"} />
        <Stat label={`Income analysed by ${r.label.toLowerCase()}`} value={share === null ? "—" : `${share}%`} tone={share !== null && share < 100 ? "amber" : "green"} />
      </StatGrid>
      <Section title={`By ${r.label.toLowerCase()}`} flush>
        <Table>
          <THead>
            <TR>
              <TH>{r.label}</TH>
              <TH className="text-right">Income</TH>
              <TH className="text-right">Expense</TH>
              <TH className="text-right">Net</TH>
              <TH className="text-right">Ledger lines</TH>
            </TR>
          </THead>
          <TBody>
            {r.rows.map((x) => (
              <TR key={x.id ?? "none"}>
                <TD className={x.id === null ? "text-muted-foreground" : ""}>{x.label}</TD>
                <TD className="text-right">{x.income ? naira(x.income) : ""}</TD>
                <TD className="text-right">{x.expense ? naira(x.expense) : ""}</TD>
                <TD className={`text-right ${x.net < 0 ? "text-red-700" : ""}`}>{x.net ? naira(x.net) : ""}</TD>
                <TD className="text-right">{x.lines}</TD>
              </TR>
            ))}
          </TBody>
          <TFoot>
            <TR>
              <TD>Whole ledger</TD>
              <TD className="text-right">{naira(r.totals.income)}</TD>
              <TD className="text-right">{naira(r.totals.expense)}</TD>
              <TD className="text-right">{naira(r.totals.net)}</TD>
              <TD className="text-right">{r.totals.lines}</TD>
            </TR>
          </TFoot>
        </Table>
      </Section>
    </>
  );
}
