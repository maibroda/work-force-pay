import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { listLetters } from "@/server/services/letters";
import { LETTER_LABELS, LETTER_TYPES } from "@/lib/letters";
import { fmtDate } from "@/lib/dates";
import { FilterBar, FilterField, PageHeader, Section, Empty } from "@/components/page";
import { Input, Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export default async function LettersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePage("hr.view");
  const sp = await searchParams;
  const rows = await listLetters(ctx, { type: sp.type, q: sp.q });
  return (
    <>
      <PageHeader
        title="Letters"
        description="Every letter issued — offer, confirmation, warning, exit, experience and clearance. Each is stored as it was issued, so changing the wording later never alters a letter already given out. Generate one from the employee's Letters tab, an offer, or an exit."
      />
      <FilterBar>
        <FilterField label="Search">
          <Input name="q" defaultValue={sp.q ?? ""} placeholder="Reference or name" className="w-52" />
        </FilterField>
        <FilterField label="Type">
          <Select name="type" defaultValue={sp.type ?? ""}>
            <option value="">All</option>
            {LETTER_TYPES.map((t) => (
              <option key={t} value={t}>
                {LETTER_LABELS[t]}
              </option>
            ))}
          </Select>
        </FilterField>
      </FilterBar>
      <Section title={`${rows.length} letter(s)`} flush>
        <Table>
          <THead>
            <TR>
              <TH>Reference</TH>
              <TH>Type</TH>
              <TH>Recipient</TH>
              <TH>Subject</TH>
              <TH>Issued</TH>
              <TH>By</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((l) => (
              <TR key={l.id}>
                <TD className="font-mono text-xs">
                  <Link className="text-primary underline" href={`/hr/letters/${l.id}`}>
                    {l.referenceNumber}
                  </Link>
                </TD>
                <TD>
                  <Badge tone="blue">{LETTER_LABELS[l.type]}</Badge>
                </TD>
                <TD>
                  {l.employeeId ? (
                    <Link className="hover:underline" href={`/employees/${l.employeeId}?tab=letters`}>
                      {l.recipientName}
                    </Link>
                  ) : (
                    l.recipientName
                  )}
                </TD>
                <TD className="max-w-xs truncate text-xs">{l.subject}</TD>
                <TD className="text-xs">{fmtDate(l.createdAt)}</TD>
                <TD className="text-xs">{l.generatedBy}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!rows.length && <Empty>No letters issued yet.</Empty>}
      </Section>
    </>
  );
}
