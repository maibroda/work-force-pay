import { requirePage } from "@/lib/auth/session";
import { welfareSummary } from "@/server/services/welfare";
import { FilterBar, FilterField, PageHeader, Section } from "@/components/page";
import { Input } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export default async function WelfareSummaryPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePage("welfare.manage");
  const sp = await searchParams;
  const year = /^\d{4}$/.test(sp.year ?? "") ? Number(sp.year) : undefined;
  const s = await welfareSummary(ctx, { year });
  return (
    <>
      <PageHeader
        title="Welfare summary"
        description={`How many welfare support requests were opened in ${s.year}, by kind. Never a name. Where fewer than ${s.minimumGroup} people are in a group the number is hidden, so no one can be picked out. The cases themselves are under Employee relations cases and are seen only by those who handle welfare.`}
      />
      <FilterBar action="/hr/welfare-summary">
        <FilterField label="Year">
          <Input name="year" defaultValue={String(s.year)} inputMode="numeric" />
        </FilterField>
      </FilterBar>
      <Section title={`Requests opened in ${s.year}`} flush>
        <Table>
          <THead>
            <TR>
              <TH>Kind of support</TH>
              <TH>Requests</TH>
            </TR>
          </THead>
          <TBody>
            {s.byKind.map((k) => (
              <TR key={k.kind}>
                <TD>{k.label}</TD>
                <TD>{k.count === null ? <span className="text-muted-foreground">fewer than {s.minimumGroup}</span> : k.count}</TD>
              </TR>
            ))}
            <TR>
              <TD className="font-medium">All welfare requests</TD>
              <TD className="font-medium">{s.total === null ? <span className="text-muted-foreground">fewer than {s.minimumGroup}</span> : s.total}</TD>
            </TR>
          </TBody>
        </Table>
      </Section>
    </>
  );
}
