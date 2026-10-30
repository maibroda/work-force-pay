import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { fmtDate } from "@/lib/dates";
import { listHandovers } from "@/server/services/sales/handover";
import { PageHeader, Section } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");
const TONE = { DRAFT: undefined, RETURNED: "red", SUBMITTED: "amber", ACCEPTED: "green" } as const;
const money = (s: unknown) => `₦${Number(s).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default async function HandoversPage() {
  const ctx = await requirePage("sales.view");
  const rows = await listHandovers(ctx);
  const waiting = rows.filter((r) => r.status === "SUBMITTED").length;
  return (
    <>
      <PageHeader title="Handovers to Operations" description="Started when a client accepts a quote. Sales completes and sends it; a designated person in Operations accepts it or returns it with a question. Only then are the client, a draft contract, its rates and the sites made." />
      {waiting > 0 && <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-900">{waiting} handover(s) are waiting for Operations.</p>}
      <Section title={`${rows.length} handover(s)`} flush>
        <Table>
          <THead>
            <TR>
              <TH>Handover</TH>
              <TH>Deal</TH>
              <TH>Status</TH>
              <TH className="text-right">Monthly bill</TH>
              <TH>Started</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.id}>
                <TD><Link className="underline" href={`/sales/handovers/${r.id}`}>{r.number}</Link></TD>
                <TD className="whitespace-normal text-xs">{r.opportunity.account.name}: {r.opportunity.name}</TD>
                <TD><Badge tone={TONE[r.status]}>{label(r.status)}</Badge></TD>
                <TD className="text-right">{money(r.monthlyBill)}</TD>
                <TD className="text-xs">{fmtDate(r.createdAt)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!rows.length && <p className="px-4 py-4 text-sm text-muted-foreground">None yet. A handover starts when a client accepts a quote.</p>}
      </Section>
    </>
  );
}
