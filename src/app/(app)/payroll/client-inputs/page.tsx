import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { listClientInputs } from "@/server/services/client-inputs";
import { fmtDate } from "@/lib/dates";
import { naira } from "@/lib/money";
import { Empty, PageHeader, Section, Stat, StatGrid } from "@/components/page";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export default async function ClientInputsPage() {
  const ctx = await requirePage("payroll.view");
  const batches = await listClientInputs(ctx);
  const waiting = batches.filter((b) => b.status === "SUBMITTED");
  return (
    <>
      <PageHeader title="Client inputs" description="Overtime, allowances, bonuses and deductions the client's HR contact has sent from the portal. Nothing reaches the payroll until it is accepted here." />
      <StatGrid cols={3}>
        <Stat label="Waiting for review" value={waiting.length} tone={waiting.length ? "amber" : "green"} />
        <Stat label="Sent after the cut-off" value={waiting.filter((b) => b.late).length} tone={waiting.some((b) => b.late) ? "red" : "green"} />
        <Stat label="Accepted" value={batches.filter((b) => b.status === "ACCEPTED").length} />
      </StatGrid>
      <Section title="Uploads" flush>
        <Table>
          <THead>
            <TR>
              <TH>No.</TH>
              <TH>Month</TH>
              <TH>Sent</TH>
              <TH>By</TH>
              <TH className="text-right">Inputs</TH>
              <TH className="text-right">Earnings</TH>
              <TH className="text-right">Deductions</TH>
              <TH>Status</TH>
            </TR>
          </THead>
          <TBody>
            {batches.map((b) => (
              <TR key={b.id}>
                <TD className="font-mono text-xs">
                  <Link className="text-primary underline" href={`/payroll/client-inputs/${b.id}`}>
                    {b.number}
                  </Link>
                </TD>
                <TD className="text-xs">{b.period.name}</TD>
                <TD className="text-xs">
                  {fmtDate(b.createdAt)} {b.late && <Badge tone="amber">late</Badge>}
                </TD>
                <TD className="text-xs">{b.submittedBy}</TD>
                <TD className="text-right">{b.rowCount}</TD>
                <TD className="text-right text-xs">{naira(b.earningsTotal)}</TD>
                <TD className="text-right text-xs">{naira(b.deductionsTotal)}</TD>
                <TD>
                  <StatusBadge status={b.status} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!batches.length && <Empty>Nothing has been sent from the portal for this client.</Empty>}
      </Section>
    </>
  );
}
