import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { BusinessError } from "@/server/services/_base";
import { getLead, linkableClients, listPartners, pipelineOwners } from "@/server/services/crm";
import { CHANNEL_LABELS, OUTCOME_LABELS, SEGMENT_LABELS, SOURCE_LABELS, STAGES, STAGE_LABELS, type Stage } from "@/lib/crm";
import { fmtDate, iso } from "@/lib/dates";
import { naira } from "@/lib/money";
import { Empty, FormPanel, KV, PageHeader, Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { logLeadOutreachAction, moveLeadAction, updateLeadAction } from "@/app/actions/crm";
import { crmGate } from "../../_gate";
import { leadFields, outreachFields, STAGE_TONE } from "../../_fields";

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("crm.view");
  const gate = await crmGate(ctx, "Lead");
  if (gate) return gate;
  const { id } = await params;
  const l = await getLead(ctx, id).catch((e) => {
    if (e instanceof BusinessError) return null;
    throw e;
  });
  if (!l) notFound();
  const manage = can(ctx.role, "crm.manage");
  const [owners, partners, clients] = await Promise.all([pipelineOwners(ctx), listPartners(ctx), linkableClients(ctx)]);
  const stage = l.stage as Stage;
  const final = stage === "WON";
  const today = iso(new Date());
  return (
    <>
      <PageHeader
        title={`${l.number} — ${l.company}`}
        crumbs={[{ href: "/crm/leads", label: "Leads" }]}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={STAGE_TONE[stage]}>{STAGE_LABELS[stage]}</Badge> since {fmtDate(l.stageChangedAt)} · owner {l.ownerName}
            {l.lostReason && <span className="text-red-700">Lost: {l.lostReason}</span>}
          </span>
        }
      />
      <Section title="The prospect">
        <KV
          cols={4}
          items={[
            ["Decision-maker", `${l.contactName}${l.contactRole ? `, ${l.contactRole}` : ""}`],
            ["Contact", [l.contactEmail, l.contactPhone].filter(Boolean).join(" · ") || "—"],
            ["Segment", SEGMENT_LABELS[l.segment]],
            ["Staff", l.headcount ?? "—"],
            ["Source", l.partner ? `Referred by ${l.partner.name}` : SOURCE_LABELS[l.source]],
            ["Expected monthly fee", Number(l.expectedMrr) ? naira(l.expectedMrr) : "—"],
            ["Next step", l.nextStep ? `${l.nextStep}${l.nextStepOn ? ` (${fmtDate(l.nextStepOn)})` : ""}` : "—"],
            ["Client", l.clientOrganizationId ? (clients.find((c) => c.id === l.clientOrganizationId)?.name ?? "Linked") : "—"],
          ]}
        />
        {l.notes && <p className="mt-3 whitespace-pre-wrap text-sm">{l.notes}</p>}
      </Section>

      {l.partner && (
        <Section title="Referral commission" description={`${l.partner.name}: ${Number(l.partner.commissionPct)}% of the monthly fee for ${l.partner.commissionMonths} months, once won.`}>
          {stage === "WON" ? (
            <KV cols={3} items={[["Earned", naira(l.commission.earned)], ["Paid", naira(l.commission.paid)], ["Still owed", naira(l.commission.owed)]]} />
          ) : (
            <p className="text-sm text-muted-foreground">Nothing is earned until this lead is won.</p>
          )}
        </Section>
      )}

      {manage && !final && (
        <FormPanel title="Move to another stage">
          <p className="mb-3 text-xs text-muted-foreground">Going back a stage or reopening a lost lead needs a note; losing needs a reason; winning needs the monthly fee.</p>
          <SmartForm
            columns={3}
            submitLabel="Move"
            resetOnSuccess
            action={moveLeadAction.bind(null, l.id)}
            fields={[
              { name: "to", label: "Move to", type: "select", required: true, options: STAGES.filter((s) => s !== stage).map((s) => ({ value: s, label: STAGE_LABELS[s] })), defaultValue: STAGES[Math.min(STAGES.indexOf(stage) + 1, 3)] },
              { name: "note", label: "Note", help: "Why, or what happened" },
              { name: "lostReason", label: "Why it was lost", help: "Needed to mark it lost" },
              { name: "expectedMrr", label: "Monthly fee (₦)", type: "number", min: 0, defaultValue: Number(l.expectedMrr) || undefined, help: "Needed to mark it won" },
              { name: "clientOrganizationId", label: "Client it became", type: "select", options: [{ value: "", label: "Not onboarded yet" }, ...clients.map((c) => ({ value: c.id, label: c.name }))], help: "When won" },
            ]}
          />
        </FormPanel>
      )}
      {final && <p className="rounded bg-muted px-3 py-2 text-sm text-muted-foreground">This lead is won, which is final. Its fee and referral partner are fixed because commission depends on them.</p>}

      {manage && (
        <FormPanel title="Edit the lead">
          <SmartForm
            columns={3}
            submitLabel="Save"
            resetOnSuccess={false}
            action={updateLeadAction.bind(null, l.id)}
            fields={leadFields({ owners: owners.map((o) => ({ value: o.id, label: o.name })), partners: partners.map((p) => ({ value: p.id, label: p.name })), lead: { ...l, nextStepOn: l.nextStepOn } })}
          />
        </FormPanel>
      )}

      <Section title="History" flush>
        <Table>
          <THead>
            <TR>
              <TH>When</TH>
              <TH>Moved</TH>
              <TH>By</TH>
              <TH>Note</TH>
            </TR>
          </THead>
          <TBody>
            {l.stageChanges.map((c) => (
              <TR key={c.id}>
                <TD className="text-xs">{fmtDate(c.at)}</TD>
                <TD className="text-xs">{c.fromStage ? `${STAGE_LABELS[c.fromStage as Stage]} → ` : "Added as "}{STAGE_LABELS[c.toStage as Stage]}</TD>
                <TD className="text-xs">{c.byName}</TD>
                <TD className="whitespace-normal text-xs">{c.note ?? ""}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Section>

      <Section title="Outreach" flush>
        <Table>
          <THead>
            <TR>
              <TH>Date</TH>
              <TH>How</TH>
              <TH>What came of it</TH>
              <TH>By</TH>
              <TH>Note</TH>
            </TR>
          </THead>
          <TBody>
            {l.activities.map((a) => (
              <TR key={a.id}>
                <TD className="text-xs">{fmtDate(a.date)}</TD>
                <TD className="text-xs">{CHANNEL_LABELS[a.channel]}</TD>
                <TD className="text-xs">{OUTCOME_LABELS[a.outcome]}</TD>
                <TD className="text-xs">{a.byName}</TD>
                <TD className="whitespace-normal text-xs">{a.note ?? ""}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!l.activities.length && <Empty>No outreach logged against this lead yet.</Empty>}
      </Section>
      {manage && (
        <FormPanel title="Log outreach to this lead">
          <SmartForm columns={3} submitLabel="Log it" resetOnSuccess action={logLeadOutreachAction.bind(null, l.id)} fields={outreachFields({ withCompany: false, today })} />
        </FormPanel>
      )}
    </>
  );
}
