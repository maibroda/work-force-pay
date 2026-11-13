import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { sensitiveAccessLog } from "@/server/services/sensitive-access";
import { ACCESS_KINDS, ACCESS_KIND_LABELS, UNUSUAL_EMPLOYEES_PER_DAY, UNUSUAL_RECORDS_PER_DAY, type AccessKind } from "@/lib/sensitive-access";
import { fmtDate } from "@/lib/dates";
import { Empty, FilterBar, FilterField, PageHeader, Section, Stat, StatGrid } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

/** What a count is a count of, for a list of records. The log shows a record by its own reference (a case number), never by the employee it is about. */
const COUNT_NOUN: Partial<Record<AccessKind, string>> = { WELFARE_CASE: "welfare cases", CONFIDENTIAL_CASE: "confidential cases", DISCIPLINARY_CASE: "disciplinary cases", SUCCESSION: "successors", IMPROVEMENT_PLAN: "plans" };

const when = (d: Date) => `${fmtDate(d)} ${d.toISOString().slice(11, 16)} UTC`;

export default async function SensitiveAccessPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePage("audit.view");
  const sp = await searchParams;
  const days = [7, 30, 90, 365].includes(Number(sp.days)) ? Number(sp.days) : 30;
  const log = await sensitiveAccessLog(ctx, { days, userId: sp.userId || undefined, kind: sp.kind || undefined });
  const unusual = log.summary.filter((s) => s.unusualDays.length);
  const people = [...new Map(log.summary.filter((s) => s.userId).map((s) => [s.userId!, s.userName])).entries()];
  return (
    <>
      <PageHeader
        title="Who looked at sensitive details"
        description="Every time someone opens people's bank, tax or pension details, guarantors and next of kin, a payslip or a payment file, it is recorded here under their own name; so is opening a welfare, confidential or disciplinary case, the succession list or an improvement plan, shown by the case number or plan reference and never by the employee it is about. Looking at your own record, and opening the same thing again within ten minutes, is not recorded again."
        actions={
          <Link className="text-sm text-primary underline" href="/reports/audit">
            Full audit log →
          </Link>
        }
      />
      <FilterBar>
        <FilterField label="Period">
          <Select name="days" defaultValue={String(days)}>
            {[7, 30, 90, 365].map((n) => (
              <option key={n} value={n}>
                Last {n} days
              </option>
            ))}
          </Select>
        </FilterField>
        <FilterField label="Person">
          <Select name="userId" defaultValue={sp.userId ?? ""}>
            <option value="">Everyone</option>
            {people.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </Select>
        </FilterField>
        <FilterField label="What">
          <Select name="kind" defaultValue={sp.kind ?? ""}>
            <option value="">Anything</option>
            {ACCESS_KINDS.map((k) => (
              <option key={k} value={k}>
                {ACCESS_KIND_LABELS[k]}
              </option>
            ))}
          </Select>
        </FilterField>
      </FilterBar>
      <StatGrid cols={3}>
        <Stat label="Times opened" value={log.entries.length} sub={log.truncated ? "showing the latest 1,000" : undefined} />
        <Stat label="People who looked" value={log.summary.length} />
        <Stat label="Worth a second look" value={unusual.length} tone={unusual.length ? "amber" : "green"} sub={`${UNUSUAL_EMPLOYEES_PER_DAY}+ different employees, or ${UNUSUAL_RECORDS_PER_DAY}+ different records, in one day`} />
      </StatGrid>
      <Section title="By person" flush>
        <Table>
          <THead>
            <TR>
              <TH>Person</TH>
              <TH className="text-right">Employees opened one by one</TH>
              <TH className="text-right">Cases, plans and succession records</TH>
              <TH className="text-right">Lists, reports and files</TH>
              <TH>Last</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {log.summary.map((s) => (
              <TR key={s.userId ?? s.userName}>
                <TD>
                  {s.userName}
                  {s.external && <Badge tone="violet">outsourced</Badge>}
                </TD>
                <TD className="text-right">{s.employees}</TD>
                <TD className="text-right">{s.records}</TD>
                <TD className="text-right">{s.lists}</TD>
                <TD className="text-xs">{when(s.lastAt)}</TD>
                <TD>{s.unusualDays.length > 0 && <Badge tone="amber">{`unusual on ${s.unusualDays.join(", ")}`}</Badge>}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!log.summary.length && <Empty>Nothing recorded in this period.</Empty>}
      </Section>
      <Section title="Every time" flush>
        <Table>
          <THead>
            <TR>
              <TH>When</TH>
              <TH>Who</TH>
              <TH>What</TH>
              <TH>Whose, or which record</TH>
            </TR>
          </THead>
          <TBody>
            {log.entries.map((e) => (
              <TR key={e.id}>
                <TD className="text-xs">{when(e.at)}</TD>
                <TD>
                  {e.userName}
                  {e.fromBureau && <Badge tone="blue">bureau staff</Badge>}
                  {e.external && <Badge tone="violet">outsourced</Badge>}
                </TD>
                <TD className="text-xs">{ACCESS_KIND_LABELS[e.kind]}</TD>
                <TD className="text-xs">{e.employee ?? e.reference ?? (e.count !== null ? `${e.count} ${COUNT_NOUN[e.kind] ?? "people"}` : e.ref ? `(${e.ref})` : "—")}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!log.entries.length && <Empty>Nothing recorded in this period.</Empty>}
      </Section>
    </>
  );
}
