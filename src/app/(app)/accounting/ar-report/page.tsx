import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { arReport, snapshotDrift } from "@/server/services/period-close";
import { AGE_BUCKETS } from "@/lib/statements";
import { db } from "@/lib/db";
import { fmtDate } from "@/lib/dates";
import { naira } from "@/lib/money";
import { Empty, FilterBar, FilterField, PageHeader, Section, Stat, StatGrid } from "@/components/page";
import { PrintButton } from "@/components/print-button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/input";
import { Table, TBody, TD, TFoot, TH, THead, TR } from "@/components/ui/table";

export default async function ArReportPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePage("gl.view");
  const sp = await searchParams;
  const periods = await db.accountingPeriod.findMany({ where: { organizationId: ctx.orgId }, orderBy: { startDate: "desc" }, take: 36, select: { id: true, name: true, status: true } });
  const chosen = sp.periodId ?? (periods.find((p) => p.status === "CLOSED" || p.status === "LOCKED") ?? periods[0])?.id;
  const report = chosen ? await arReport(ctx, chosen).catch(() => null) : null;
  const drift = report?.official ? await snapshotDrift(ctx, chosen!) : null;
  const r = report?.data.receivables;
  return (
    <>
      <PageHeader
        title="Monthly receivables report"
        description="What each client owed at the end of a month, aged by how long past due. For a closed month this is the snapshot taken when it closed: it does not change when later activity posts, so September's report is the same in November. For a month still open it is a live calculation and says so. A closed month's figures are also recalculated and compared, to show whether anything has moved since."
        actions={report ? <PrintButton /> : undefined}
      />
      <FilterBar>
        <FilterField label="Month">
          <Select name="periodId" defaultValue={chosen ?? ""}>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.status.toLowerCase().replace("_", " ")})
              </option>
            ))}
          </Select>
        </FilterField>
      </FilterBar>
      {!report && <Empty>No accounting periods yet.</Empty>}
      {report && r && (
        <>
          <p className={`mb-4 rounded-md p-3 text-sm ${report.official ? "bg-green-50 text-green-900" : "bg-amber-50 text-amber-900"}`}>
            {report.official
              ? `Official: snapshot v${report.version} taken ${fmtDate(report.takenAt)} by ${report.takenBy} when ${report.period.name} closed.${report.checksumOk ? " Its checksum verifies: it has not been altered." : " ITS CHECKSUM DOES NOT VERIFY: the record has been altered."}`
              : `Not official: ${report.period.name} is ${report.period.status.toLowerCase().replace("_", " ")}, so these are live figures as at ${fmtDate(report.period.endDate)}. They become the official report when the period closes.`}{" "}
            <Link className="underline" href={`/accounting/periods/${report.period.id}`}>
              Close centre →
            </Link>
          </p>
          {drift && (
            <p className={`mb-4 rounded-md p-3 text-sm ${drift.difference === 0 ? "bg-muted/50" : "bg-red-50 text-red-900"}`}>
              {drift.difference === 0
                ? "Recalculated now as at the same date, the receivables agree with the snapshot: nothing has moved since the period closed."
                : `Recalculated now as at the same date, receivables are ${naira(drift.nowTotal)} against ${naira(drift.snapshotTotal)} in the snapshot (${naira(drift.difference)} different), for ${drift.moved.map((m) => m.name).join(", ")}. The snapshot is the record; the difference means source records changed after close.`}
            </p>
          )}
          <StatGrid cols={4}>
            <Stat label={`Owed at ${fmtDate(report.data.period.end)}`} value={naira(r.total)} />
            <Stat label="Agrees with the ledger" value={r.total === r.ledger ? "Yes" : naira(r.ledger)} tone={r.total === r.ledger ? "green" : "red"} />
            <Stat label="Advances held" value={naira(r.advances)} />
            <Stat label="Clients owing" value={r.clients.filter((c) => c.owed !== 0).length} />
          </StatGrid>
          <Section title="By client" flush>
            <Table>
              <THead>
                <TR>
                  <TH>Client</TH>
                  {AGE_BUCKETS.map((b) => (
                    <TH key={b} className="text-right">
                      {b}
                    </TH>
                  ))}
                  <TH className="text-right">Owed</TH>
                  <TH className="text-right">Advances</TH>
                </TR>
              </THead>
              <TBody>
                {r.clients.map((c) => (
                  <TR key={c.clientId}>
                    <TD>
                      <Link className="text-primary underline" href={`/finance/statements/${c.clientId}?asOf=${report.data.period.end}`}>
                        {c.name}
                      </Link>
                    </TD>
                    {AGE_BUCKETS.map((b) => (
                      <TD key={b} className="text-right">
                        {c.ageing[b] ? naira(c.ageing[b]) : "—"}
                      </TD>
                    ))}
                    <TD className="text-right font-medium">{naira(c.owed)}</TD>
                    <TD className="text-right">{c.advances ? naira(c.advances) : "—"}</TD>
                  </TR>
                ))}
              </TBody>
              {r.clients.length > 0 && (
                <TFoot>
                  <TR>
                    <TD>Total</TD>
                    {AGE_BUCKETS.map((b) => (
                      <TD key={b} className="text-right">
                        {naira(r.clients.reduce((s, c) => s + (c.ageing[b] ?? 0), 0))}
                      </TD>
                    ))}
                    <TD className="text-right">{naira(r.total)}</TD>
                    <TD className="text-right">{naira(r.advances)}</TD>
                  </TR>
                </TFoot>
              )}
            </Table>
            {!r.clients.length && <Empty>Nothing was owed at the end of this month.</Empty>}
          </Section>
          <Section title="Invoices still owing" flush>
            <Table>
              <THead>
                <TR>
                  <TH>Invoice</TH>
                  <TH>Client</TH>
                  <TH>Due</TH>
                  <TH className="text-right">Days past due</TH>
                  <TH>Age</TH>
                  <TH className="text-right">Owed</TH>
                </TR>
              </THead>
              <TBody>
                {r.invoices.map((i) => (
                  <TR key={i.invoiceId}>
                    <TD className="font-mono text-xs">
                      <Link className="text-primary underline" href={`/finance/invoices/${i.invoiceId}`}>
                        {i.number}
                      </Link>
                    </TD>
                    <TD>{i.client}</TD>
                    <TD className="text-xs">{fmtDate(i.dueDate)}</TD>
                    <TD className="text-right">{i.daysPastDue > 0 ? i.daysPastDue : "—"}</TD>
                    <TD>
                      <Badge tone={i.daysPastDue > 60 ? "red" : i.daysPastDue > 0 ? "amber" : "gray"}>{i.bucket}</Badge>
                    </TD>
                    <TD className="text-right">{naira(i.balance)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Section>
        </>
      )}
    </>
  );
}
