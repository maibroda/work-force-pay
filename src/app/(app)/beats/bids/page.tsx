import { requirePage } from "@/lib/auth/session";
import { listBeats } from "@/server/services/clients";
import { PageHeader, Section } from "@/components/page";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export default async function BidsPage() {
  const ctx = await requirePage("client.view");
  const beats = await listBeats(ctx);
  const groups = new Map<string, typeof beats>();
  for (const b of beats)
    groups.set(b.bidReference ?? "No bid reference", [
      ...(groups.get(b.bidReference ?? "No bid reference") ?? []),
      b,
    ]);
  return (
    <>
      <PageHeader
        title="Bids"
        description="Bids are optional references that group beats (the hierarchy is Client → Contract → Beat). Set the bid reference when creating a beat."
      />
      {[...groups.entries()].sort().map(([bid, list]) => (
        <Section
          key={bid}
          title={bid}
          description={`${list[0].client.name} · ${list.length} beat(s) · approved ${list.reduce((a, b) => a + b.approvedStrength, 0)} / actual ${list.reduce((a, b) => a + b.actualStrength, 0)}`}
          flush
        >
          <Table>
            <THead>
              <TR>
                <TH>Beat</TH>
                <TH>Contract</TH>
                <TH>State</TH>
                <TH className="text-right">Approved</TH>
                <TH className="text-right">Actual</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {list.map((b) => (
                <TR key={b.id}>
                  <TD>{b.name}</TD>
                  <TD className="font-mono text-xs">{b.contract.contractNumber}</TD>
                  <TD>{b.state}</TD>
                  <TD className="text-right">{b.approvedStrength}</TD>
                  <TD className="text-right">{b.actualStrength}</TD>
                  <TD>
                    <StatusBadge status={b.status} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Section>
      ))}
    </>
  );
}
