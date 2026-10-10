import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { billingOverview } from "@/server/services/billing-rules";
import { BASE_LABELS, RULE_STATUS_LABELS, SOURCE_LABELS, type BillingBase, type RuleStatus } from "@/lib/billing-rules";
import { fmtDate, iso } from "@/lib/dates";
import { num } from "@/lib/money";
import { Empty, FormPanel, PageHeader, Section } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { SmartForm, type Field } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import {
  assignServiceTypeAction,
  decideRuleAction,
  installStandardBillingAction,
  proposeContractRuleAction,
  proposeServiceRuleAction,
  saveServiceTypeAction,
  setServiceTypeActiveAction,
} from "@/app/actions/billing-rules";

const tone: Record<RuleStatus, "amber" | "green" | "red"> = { PENDING: "amber", APPROVED: "green", REJECTED: "red" };
const baseOptions = (Object.keys(BASE_LABELS) as BillingBase[]).map((b) => ({ value: b, label: BASE_LABELS[b] }));

type RuleLike = { id: string; directPct: unknown; indirectPct: unknown; vatBase: string; whtBase: string; effectiveFrom: Date; effectiveTo: Date | null; status: string; reason: string; requestedBy: string; decidedBy: string | null; decisionNote: string | null };

function RulesTable({ rules }: { rules: RuleLike[] }) {
  if (!rules.length) return <Empty>No rule yet. The built-in default (90% direct, 10% indirect, VAT on the indirect charge, withholding on the whole amount) applies.</Empty>;
  return (
    <Table>
      <THead>
        <TR>
          <TH>Split</TH>
          <TH>VAT on</TH>
          <TH>Withholding on</TH>
          <TH>From</TH>
          <TH>To</TH>
          <TH>Status</TH>
          <TH>Why</TH>
        </TR>
      </THead>
      <TBody>
        {rules.map((r) => (
          <TR key={r.id}>
            <TD className="whitespace-nowrap">
              {num(r.directPct)} / {num(r.indirectPct)}
            </TD>
            <TD className="text-xs">{BASE_LABELS[r.vatBase as BillingBase]}</TD>
            <TD className="text-xs">{BASE_LABELS[r.whtBase as BillingBase]}</TD>
            <TD className="text-xs">{fmtDate(r.effectiveFrom)}</TD>
            <TD className="text-xs">{r.effectiveTo ? fmtDate(r.effectiveTo) : "open"}</TD>
            <TD>
              <Badge tone={tone[r.status as RuleStatus]}>{RULE_STATUS_LABELS[r.status as RuleStatus]}</Badge>
              {r.decidedBy && <div className="text-xs text-muted-foreground">{r.decidedBy}</div>}
            </TD>
            <TD className="max-w-[24rem] whitespace-normal text-xs">
              {r.reason}
              <div className="text-muted-foreground">Proposed by {r.requestedBy}</div>
              {r.decisionNote ? <div className="text-muted-foreground">Decision: {r.decisionNote}</div> : null}
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

export default async function BillingRulesPage() {
  const ctx = await requirePage("gl.view");
  const o = await billingOverview(ctx);
  const manage = can(ctx.role, "billing.rule.manage");
  const approve = can(ctx.role, "billing.rule.approve");
  const today = iso(new Date());
  const codeOptions = (type: "VAT" | "WHT") => [{ value: "", label: "The organization's default code" }, ...o.codes.filter((c) => c.type === type && c.active).map((c) => ({ value: c.id, label: c.code }))];
  const ruleFields = (): Field[] => [
    { name: "directPct", label: "Direct charge %", type: "number", min: 0, max: 100, required: true, defaultValue: 90 },
    { name: "indirectPct", label: "Indirect charge %", type: "number", min: 0, max: 100, required: true, defaultValue: 10, help: "Must add up to 100% with the direct charge." },
    { name: "effectiveFrom", label: "Takes effect on", type: "date", required: true, defaultValue: today },
    { name: "vatBase", label: "VAT is charged on", type: "select", required: true, defaultValue: "INDIRECT", options: baseOptions },
    { name: "whtBase", label: "Withholding tax is expected on", type: "select", required: true, defaultValue: "FULL", options: baseOptions },
    { name: "effectiveTo", label: "Ends on (optional)", type: "date" },
    { name: "vatTaxCodeId", label: "VAT code", type: "select", options: codeOptions("VAT") },
    { name: "whtTaxCodeId", label: "Withholding code", type: "select", options: codeOptions("WHT") },
    { name: "reason", label: "Why / which agreement", type: "text", required: true, span: 3, placeholder: "e.g. Contract clause 4.2 agreed with the client on 1 Oct" },
  ];
  const contractOptions = o.contracts.map((c) => ({ value: c.id, label: `${c.contractNumber} — ${c.name} (${c.client.name})` }));
  const typeOptions = o.types.filter((t) => t.active).map((t) => ({ value: t.id, label: `${t.code} — ${t.name}` }));
  const typeName = (id: string | null) => o.types.find((t) => t.id === id)?.name ?? "None";

  return (
    <>
      <PageHeader
        title="Billing rules"
        description="How each service and contract is billed: the split of every charge-out amount into a direct (pass-through) and an indirect (management) charge, and what VAT and withholding tax are charged on. A service type carries the default rule for its contracts; a contract can carry its own override. A rule is proposed by one person and approved by another and, once approved, is never edited: a change is a new rule from a later date, which can't start on or before an invoice already issued under it. Invoices keep the rule they were calculated under, so a change never touches an invoice already issued. A contract with no rule is billed on the built-in default. Whether a treatment is right for a client agreement is a question for your tax adviser."
        actions={
          approve && !o.types.length ? (
            <ActionButton action={installStandardBillingAction} confirm="Create Security & Guarding with the standard treatment (90% direct, 10% indirect, VAT on the indirect charge) and put every contract under it? What is billed does not change." variant="outline">
              Set up the standard treatment
            </ActionButton>
          ) : undefined
        }
      />

      {o.pending.length > 0 && (
        <Section title="Rules waiting for approval" flush>
          <Table>
            <THead>
              <TR>
                <TH>For</TH>
                <TH>Split</TH>
                <TH>VAT on</TH>
                <TH>From</TH>
                <TH>Why</TH>
                <TH>Proposed by</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {o.pending.map((r) => {
                const c = o.contracts.find((x) => x.id === r.contractId);
                return (
                  <TR key={r.id}>
                    <TD className="text-xs">{c ? `Contract ${c.contractNumber} (${c.client.name})` : `Service ${typeName(r.serviceTypeId)}`}</TD>
                    <TD className="whitespace-nowrap">
                      {num(r.directPct)} / {num(r.indirectPct)}
                    </TD>
                    <TD className="text-xs">{BASE_LABELS[r.vatBase as BillingBase]}</TD>
                    <TD className="text-xs">{fmtDate(r.effectiveFrom)}</TD>
                    <TD className="max-w-[20rem] whitespace-normal text-xs">{r.reason}</TD>
                    <TD className="text-xs">{r.requestedBy}</TD>
                    <TD className="space-x-1 whitespace-nowrap text-right">
                      {approve && r.requestedByUserId !== ctx.userId && (
                        <>
                          <ActionButton action={decideRuleAction.bind(null, r.id, true)} confirm={`Approve this rule from ${fmtDate(r.effectiveFrom)}? Invoices dated on or after that day will be billed under it.`} variant="success">
                            Approve
                          </ActionButton>
                          <ActionButton action={decideRuleAction.bind(null, r.id, false)} reason reasonPlaceholder="Why it is being turned down" variant="outline">
                            Turn down
                          </ActionButton>
                        </>
                      )}
                      {r.requestedByUserId === ctx.userId && <span className="text-xs text-muted-foreground">Waiting for someone else</span>}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </Section>
      )}

      {o.types.map((t) => (
        <Section key={t.id} title={`${t.code} — ${t.name}`} description={`${t._count.contracts} contract(s)${t.active ? "" : " · inactive"}`} flush>
          <RulesTable rules={t.rules} />
          {manage && t.active && (
            <div className="border-t px-4 py-3">
              <SmartForm columns={3} submitLabel="Propose rule" action={proposeServiceRuleAction.bind(null, t.id)} fields={ruleFields()} />
            </div>
          )}
          {manage && (
            <div className="px-4 pb-3">
              <ActionButton action={setServiceTypeActiveAction.bind(null, t.id, !t.active)} variant="outline">
                {t.active ? "Deactivate" : "Reactivate"}
              </ActionButton>
            </div>
          )}
        </Section>
      ))}

      <Section title="Contracts" description="The treatment each contract is billed under today, and where it comes from." flush>
        <Table>
          <THead>
            <TR>
              <TH>Contract</TH>
              <TH>Service type</TH>
              <TH>Billed today as</TH>
              <TH>Split</TH>
              <TH>VAT on</TH>
              <TH>Overrides</TH>
            </TR>
          </THead>
          <TBody>
            {o.contracts.map((c) => (
              <TR key={c.id}>
                <TD className="text-xs">
                  <span className="font-mono">{c.contractNumber}</span> {c.name}
                  <div className="text-muted-foreground">{c.client.name}</div>
                </TD>
                <TD className="text-xs">{typeName(c.serviceTypeId)}</TD>
                <TD>
                  <Badge tone={c.now.source === "CONTRACT_OVERRIDE" ? "amber" : c.now.source === "SERVICE_RULE" ? "green" : "gray"}>{SOURCE_LABELS[c.now.source]}</Badge>
                </TD>
                <TD className="whitespace-nowrap">
                  {c.now.directPct} / {c.now.indirectPct}
                </TD>
                <TD className="text-xs">{BASE_LABELS[c.now.vatBase]}</TD>
                <TD className="text-xs">{c.rules.length ? `${c.rules.length} (${c.rules.filter((r) => r.status === "APPROVED").length} approved)` : "—"}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!o.contracts.length && <Empty>No contracts yet.</Empty>}
      </Section>

      {o.contracts.some((c) => c.rules.length) && (
        <Section title="Contract overrides" flush>
          {o.contracts
            .filter((c) => c.rules.length)
            .map((c) => (
              <div key={c.id} className="border-b last:border-0">
                <p className="px-4 pt-3 text-sm font-medium">
                  {c.contractNumber} — {c.name} <span className="text-muted-foreground">({c.client.name})</span>
                </p>
                <RulesTable rules={c.rules} />
              </div>
            ))}
        </Section>
      )}

      {manage && o.contracts.length > 0 && (
        <FormPanel title="Propose an override for one contract">
          <SmartForm columns={3} submitLabel="Propose override" action={proposeContractRuleAction} fields={[{ name: "contractId", label: "Contract", type: "select", required: true, options: contractOptions, span: 3 }, ...ruleFields()]} />
        </FormPanel>
      )}

      {approve && typeOptions.length > 0 && o.contracts.length > 0 && (
        <FormPanel title="Move a contract to a service type">
          <SmartForm
            columns={3}
            submitLabel="Move contract"
            action={assignServiceTypeAction}
            fields={[
              { name: "contractId", label: "Contract", type: "select", required: true, options: contractOptions },
              { name: "serviceTypeId", label: "Service type", type: "select", required: true, options: typeOptions },
              { name: "reason", label: "Why", type: "text", required: true },
            ]}
          />
        </FormPanel>
      )}

      {manage && (
        <FormPanel title="New service type">
          <SmartForm
            columns={2}
            submitLabel="Create service type"
            action={saveServiceTypeAction}
            fields={[
              { name: "code", label: "Code", type: "text", required: true, placeholder: "e.g. CONSULTING" },
              { name: "name", label: "Name", type: "text", required: true, placeholder: "e.g. Consulting & Advisory" },
            ]}
          />
        </FormPanel>
      )}
    </>
  );
}
