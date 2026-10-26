import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { BusinessError } from "@/server/services/_base";
import { getProposal, getRateCard } from "@/server/services/proposals";
import { PACKAGE_NAMES } from "@/lib/pricing";
import { fmtDate } from "@/lib/dates";
import { naira } from "@/lib/money";
import { FormPanel, KV, PageHeader, Section } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { SmartForm } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { approveBelowMarginAction, decideProposalAction, reviseProposalAction, sendProposalAction, updateProposalAction, withdrawProposalAction } from "@/app/actions/proposals";
import { crmGate } from "../../_gate";
import { proposalFields } from "../../_fields";
import { PROPOSAL_STATE_TONE } from "../_tone";

export default async function ProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("crm.view");
  const gate = await crmGate(ctx, "Proposal");
  if (gate) return gate;
  const { id } = await params;
  const p = await getProposal(ctx, id).catch((e) => {
    if (e instanceof BusinessError) return null;
    throw e;
  });
  if (!p) notFound();
  const card = await getRateCard(ctx);
  const q = p.q;
  const manage = can(ctx.role, "crm.manage");
  const owner = can(ctx.role, "pricing.manage");
  const unsent = p.status === "DRAFT" || p.status === "APPROVED";
  return (
    <>
      <PageHeader
        title={`${p.number} — ${p.lead.company}`}
        crumbs={[{ href: "/crm/proposals", label: "Proposals" }]}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={PROPOSAL_STATE_TONE[p.state]}>{p.state.charAt(0) + p.state.slice(1).toLowerCase()}</Badge>
            <Link className="text-primary underline" href={`/crm/leads/${p.leadId}`}>
              {p.lead.number}
            </Link>
            {p.validUntil && <span>open until {fmtDate(p.validUntil)}</span>}
          </span>
        }
        actions={
          <a className={buttonVariants({ variant: "outline" })} href={`/api/crm/proposals/${p.id}/pdf`}>
            {unsent ? "Download draft PDF" : "Download PDF"}
          </a>
        }
      />

      {unsent && !p.rateCardConfirmed && (
        <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm">
          The rate card is not confirmed, so these prices are placeholders and this can&apos;t be sent yet. <Link className="text-primary underline" href="/crm/pricing">See the rate card</Link>.
        </p>
      )}

      <Section title="The offer">
        <Table>
          <THead>
            <TR>
              <TH />
              <TH className="text-right">Monthly</TH>
              <TH className="text-right">One-off</TH>
            </TR>
          </THead>
          <TBody>
            <TR>
              <TD>
                {PACKAGE_NAMES[q.package.key as keyof typeof PACKAGE_NAMES] ?? q.package.name}, {q.headcount} employees{" "}
                <span className="text-xs text-muted-foreground">({q.package.basis === "MINIMUM" ? "monthly minimum applies" : "per-employee fee"})</span>
              </TD>
              <TD className="text-right">{naira(q.package.monthly)}</TD>
              <TD className="text-right">{q.package.onboarding ? naira(q.package.onboarding) : "—"}</TD>
            </TR>
            {q.addOns.map((a) => (
              <TR key={a.code}>
                <TD>{a.name}</TD>
                <TD className="text-right">{naira(a.monthly)}</TD>
                <TD className="text-right">{a.onboarding ? naira(a.onboarding) : "—"}</TD>
              </TR>
            ))}
            {q.discount > 0 && (
              <TR>
                <TD>
                  Discount ({q.discountPct}%) <span className="text-xs text-muted-foreground">{p.discountReason}</span>
                </TD>
                <TD className="text-right">-{naira(q.discount)}</TD>
                <TD className="text-right">—</TD>
              </TR>
            )}
            <TR>
              <TD className="font-medium">Total, excluding VAT</TD>
              <TD className="text-right font-medium">{naira(q.monthlyFee)}</TD>
              <TD className="text-right font-medium">{naira(q.onboardingFee)}</TD>
            </TR>
            <TR>
              <TD>VAT at {q.vatRatePct}%</TD>
              <TD className="text-right">{naira(q.vat)}</TD>
              <TD className="text-right">{naira(q.onboardingVat)}</TD>
            </TR>
          </TBody>
        </Table>
        <p className="mt-3 text-sm text-muted-foreground">
          {q.termMonths} months: {naira(q.contractValue)} over the term, excluding VAT.
        </p>
      </Section>

      <Section title="Is the price right?" description="Headcount alone doesn't decide it: this is what delivering the work costs, and the lowest fee that still earns the target margin.">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {q.belowCost ? <Badge tone="red">Below cost</Badge> : q.belowTarget ? <Badge tone="amber">Below the {q.targetMarginPct}% target margin</Badge> : <Badge tone="green">Meets the {q.targetMarginPct}% target margin</Badge>}
          <span className="text-sm">
            Margin <b>{q.marginPct}%</b> · lowest fee that earns the target: <b>{naira(q.floorMonthly)}</b> a month
          </span>
        </div>
        {owner ? (
          <KV
            cols={4}
            items={[
              ["Officer hours a month", `${q.cost.hours}${q.cost.extraHours ? ` (incl. ${q.cost.extraHours} extra)` : ""}`],
              ["Labour", naira(q.cost.labour)],
              ["Software and support", naira(q.cost.software)],
              ["Overhead", naira(q.cost.overhead)],
              ["Total cost a month", naira(q.cost.total)],
              ["Margin a month", naira(q.marginAmount)],
            ]}
          />
        ) : (
          <p className="text-xs text-muted-foreground">The cost behind this is held by whoever owns pricing.</p>
        )}
      </Section>

      {p.belowTarget && (
        <Section title="Approval">
          {p.status === "APPROVED" || p.approvedAt ? (
            <p className="text-sm">
              Approved by <b>{p.approvedBy}</b> on {p.approvedAt ? fmtDate(p.approvedAt) : ""}: {p.approvalNote}
            </p>
          ) : unsent ? (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span>This price is below the target margin, so it can&apos;t be sent until the pricing owner approves it, with a reason.</span>
              {owner ? (
                <ActionButton action={approveBelowMarginAction.bind(null, p.id)} reason reasonPlaceholder="Why is this price acceptable?">
                  Approve this price
                </ActionButton>
              ) : (
                <span className="text-muted-foreground">Ask the pricing owner.</span>
              )}
            </div>
          ) : null}
        </Section>
      )}

      {manage && (
        <Section title="What next">
          <div className="flex flex-wrap items-center gap-2">
            {unsent && (
              <ActionButton action={sendProposalAction.bind(null, p.id)} confirm="Mark as sent? What it says is then fixed.">
                Mark as sent
              </ActionButton>
            )}
            {unsent && (
              <ActionButton action={withdrawProposalAction.bind(null, p.id)} variant="outline" reason reasonPlaceholder="Why withdraw it?">
                Withdraw
              </ActionButton>
            )}
            {p.status === "SENT" && (
              <>
                <ActionButton action={decideProposalAction.bind(null, p.id, "ACCEPTED")} reason reasonPlaceholder="How did they accept?">
                  They accepted
                </ActionButton>
                <ActionButton action={decideProposalAction.bind(null, p.id, "DECLINED")} variant="outline" reason reasonPlaceholder="Why did they decline?">
                  They declined
                </ActionButton>
                <ActionButton action={reviseProposalAction.bind(null, p.id)} variant="outline" confirm="Make a new draft from this and replace it?">
                  Revise
                </ActionButton>
              </>
            )}
            {!unsent && p.status !== "SENT" && <span className="text-sm text-muted-foreground">{p.decisionNote ?? "This proposal is closed."}</span>}
          </div>
        </Section>
      )}

      {manage && unsent && (
        <FormPanel title="Change the terms">
          <p className="mb-3 text-xs text-muted-foreground">Saving reprices it from the rate card as it is today, and withdraws any earlier approval.</p>
          <SmartForm
            columns={3}
            submitLabel="Reprice and save"
            resetOnSuccess={false}
            action={updateProposalAction.bind(null, p.id)}
            fields={proposalFields({ packages: card.packages.map((x) => ({ key: x.key, name: x.name, active: x.active })), addOns: card.addOns, p, showHours: owner })}
          />
        </FormPanel>
      )}

      <Section title="The wording that goes on the page">
        <p className="text-xs font-medium">Included</p>
        <ul className="mb-3 list-disc pl-5 text-sm">
          {q.scope.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
        <p className="text-xs font-medium">What the client does</p>
        <ul className="list-disc pl-5 text-sm">
          {q.responsibilities.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
        {p.sentAt && <p className="mt-3 text-xs text-muted-foreground">Sent by {p.sentBy} on {fmtDate(p.sentAt)}. The wording above is as it was then.</p>}
      </Section>
    </>
  );
}
