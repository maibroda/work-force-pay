import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { listProposals } from "@/server/services/proposals";
import { fmtDate } from "@/lib/dates";
import { naira } from "@/lib/money";
import { PACKAGE_NAMES } from "@/lib/pricing";
import { Empty, FilterBar, FilterField, PageHeader, Section } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { crmGate } from "../_gate";
import { PROPOSAL_STATE_TONE } from "./_tone";

const STATES = ["DRAFT", "APPROVED", "SENT", "EXPIRED", "ACCEPTED", "DECLINED", "SUPERSEDED", "WITHDRAWN"] as const;

export default async function ProposalsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePage("crm.view");
  const gate = await crmGate(ctx, "Proposals");
  if (gate) return gate;
  const sp = await searchParams;
  const rows = await listProposals(ctx, { status: sp.status });
  return (
    <>
      <PageHeader title="Proposals" crumbs={[{ href: "/crm", label: "Sales pipeline" }]} description="Every offer made to a lead. A proposal is made from the lead's own page, priced from the rate card, and can't be sent below the target margin without the pricing owner's approval." />
      <FilterBar>
        <FilterField label="Status">
          <Select name="status" defaultValue={sp.status ?? ""}>
            <option value="">All</option>
            {STATES.map((s) => (
              <option key={s} value={s}>
                {s.charAt(0) + s.slice(1).toLowerCase()}
              </option>
            ))}
          </Select>
        </FilterField>
      </FilterBar>
      <Section title={`${rows.length} proposal(s)`} flush>
        <Table>
          <THead>
            <TR>
              <TH>No.</TH>
              <TH>Lead</TH>
              <TH>Package</TH>
              <TH className="text-right">Staff</TH>
              <TH className="text-right">Monthly fee</TH>
              <TH className="text-right">Margin</TH>
              <TH>Status</TH>
              <TH>Open until</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((p) => (
              <TR key={p.id}>
                <TD className="font-mono text-xs">
                  <Link className="text-primary underline" href={`/crm/proposals/${p.id}`}>
                    {p.number}
                  </Link>
                </TD>
                <TD className="text-xs">
                  <Link className="underline" href={`/crm/leads/${p.leadId}`}>
                    {p.lead.company}
                  </Link>
                </TD>
                <TD className="text-xs">{PACKAGE_NAMES[p.packageKey as keyof typeof PACKAGE_NAMES] ?? p.packageKey}</TD>
                <TD className="text-right">{p.headcount}</TD>
                <TD className="text-right text-xs">{naira(p.monthlyFee)}</TD>
                <TD className={`text-right text-xs ${p.belowTarget ? "font-medium text-red-700" : ""}`}>{Number(p.marginPct)}%</TD>
                <TD>
                  <Badge tone={PROPOSAL_STATE_TONE[p.state]}>{p.state.charAt(0) + p.state.slice(1).toLowerCase()}</Badge>
                </TD>
                <TD className="text-xs">{p.validUntil ? fmtDate(p.validUntil) : "—"}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!rows.length && <Empty>No proposals yet. Open a lead and make one.</Empty>}
      </Section>
    </>
  );
}
