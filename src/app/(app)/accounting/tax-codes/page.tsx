import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { listTaxCodes, pendingRates } from "@/server/services/tax-engine";
import { RATE_STATUS_LABELS, TAX_TYPE_LABELS, type RateStatus, type TaxType } from "@/lib/tax-engine";
import { fmtDate, iso } from "@/lib/dates";
import { num } from "@/lib/money";
import { Empty, FormPanel, PageHeader, Section } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { SmartForm } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { decideRateAction, installStandardTaxAction, proposeRateAction, saveTaxCodeAction, setDefaultTaxCodeAction, setTaxCodeActiveAction } from "@/app/actions/tax-engine";

const tone: Record<RateStatus, "amber" | "green" | "red"> = { PENDING: "amber", APPROVED: "green", REJECTED: "red" };

export default async function TaxCodesPage() {
  const ctx = await requirePage("gl.view");
  const [codes, pending] = await Promise.all([listTaxCodes(ctx), pendingRates(ctx)]);
  const manage = can(ctx.role, "tax.manage");
  const approve = can(ctx.role, "tax.approve");
  const today = iso(new Date());
  return (
    <>
      <PageHeader
        title="Tax codes & rates"
        description="Each tax (VAT, withholding tax) is a code with rates by date. An invoice reads the rate in force on its own date and keeps what it used, so changing a rate never touches an invoice already issued. A rate is proposed by one person and approved by another; once approved it is never edited or deleted. A change is a new rate from a later date, which ends the old one the day before. The rates here are as you set them: they are not tax advice, and your tax adviser should confirm them."
        actions={
          manage && !codes.length ? (
            <ActionButton action={installStandardTaxAction} confirm="Create a VAT code and a withholding-tax code with proposed rates? Someone else has to approve the rates." variant="outline">
              Set up VAT and withholding
            </ActionButton>
          ) : undefined
        }
      />

      {pending.length > 0 && (
        <Section title="Rates waiting for approval" flush>
          <Table>
            <THead>
              <TR>
                <TH>Code</TH>
                <TH className="text-right">Rate</TH>
                <TH>From</TH>
                <TH>Why</TH>
                <TH>Proposed by</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {pending.map((r) => (
                <TR key={r.id}>
                  <TD>
                    <span className="font-mono">{r.taxCode.code}</span> <span className="text-xs text-muted-foreground">{r.taxCode.name}</span>
                  </TD>
                  <TD className="text-right">{num(r.ratePct)}%</TD>
                  <TD className="text-xs">{fmtDate(r.effectiveFrom)}</TD>
                  <TD className="max-w-[20rem] whitespace-normal text-xs">{r.reason}</TD>
                  <TD className="text-xs">
                    {r.requestedBy}
                    <div className="text-muted-foreground">{fmtDate(r.createdAt)}</div>
                  </TD>
                  <TD className="space-x-1 whitespace-nowrap text-right">
                    {approve && r.requestedByUserId !== ctx.userId && (
                      <>
                        <ActionButton action={decideRateAction.bind(null, r.id, true)} confirm={`Approve ${num(r.ratePct)}% from ${fmtDate(r.effectiveFrom)}? Invoices dated on or after that day will use it.`} variant="success">
                          Approve
                        </ActionButton>
                        <ActionButton action={decideRateAction.bind(null, r.id, false)} reason reasonPlaceholder="Why it is being turned down" variant="outline">
                          Turn down
                        </ActionButton>
                      </>
                    )}
                    {r.requestedByUserId === ctx.userId && <span className="text-xs text-muted-foreground">Waiting for someone else</span>}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Section>
      )}

      {codes.map((c) => (
        <Section
          key={c.id}
          title={`${c.code} — ${c.name}`}
          description={`${TAX_TYPE_LABELS[c.type as TaxType]}${c.accountCode ? ` · booked to account ${c.accountCode}` : ""} · ${c.current ? `${num(c.current.ratePct)}% today` : "no rate in force today"}`}
          flush
        >
          <div className="flex flex-wrap items-center gap-2 px-4 py-2">
            {c.isDefault && <Badge tone="green">Default for {c.type}</Badge>}
            {!c.active && <Badge tone="gray">Inactive</Badge>}
            {manage && !c.isDefault && c.active && (
              <ActionButton action={setDefaultTaxCodeAction.bind(null, c.id)} confirm={`Make ${c.code} the code invoices use for ${c.type}?`} variant="outline">
                Make default
              </ActionButton>
            )}
            {manage && !c.isDefault && (
              <ActionButton action={setTaxCodeActiveAction.bind(null, c.id, !c.active)} variant="outline">
                {c.active ? "Deactivate" : "Reactivate"}
              </ActionButton>
            )}
          </div>
          <Table>
            <THead>
              <TR>
                <TH className="text-right">Rate</TH>
                <TH>From</TH>
                <TH>To</TH>
                <TH>Status</TH>
                <TH>Why</TH>
              </TR>
            </THead>
            <TBody>
              {c.rates.map((r) => (
                <TR key={r.id}>
                  <TD className="text-right">{num(r.ratePct)}%</TD>
                  <TD className="text-xs">{fmtDate(r.effectiveFrom)}</TD>
                  <TD className="text-xs">{r.effectiveTo ? fmtDate(r.effectiveTo) : "open"}</TD>
                  <TD>
                    <Badge tone={tone[r.status as RateStatus]}>{RATE_STATUS_LABELS[r.status as RateStatus]}</Badge>
                    {r.decidedBy && <div className="text-xs text-muted-foreground">{r.decidedBy}</div>}
                  </TD>
                  <TD className="max-w-[24rem] whitespace-normal text-xs">
                    {r.reason}
                    {r.decisionNote ? <div className="text-muted-foreground">Decision: {r.decisionNote}</div> : null}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          {!c.rates.length && <Empty>No rate yet. Propose one below.</Empty>}
          {manage && (
            <div className="border-t px-4 py-3">
              <SmartForm
                columns={3}
                submitLabel="Propose rate"
                action={proposeRateAction.bind(null, c.id)}
                fields={[
                  { name: "ratePct", label: "Rate %", type: "number", min: 0, max: 100, required: true },
                  { name: "effectiveFrom", label: "Takes effect on", type: "date", required: true, defaultValue: today },
                  { name: "reason", label: "Why / which notice", type: "text", required: true, placeholder: "e.g. Finance Act 2019, s. 2" },
                ]}
              />
            </div>
          )}
        </Section>
      ))}
      {!codes.length && <Empty>No tax codes yet. Invoices carry whatever rate is typed for the run, or none.</Empty>}

      {manage && (
        <FormPanel title="New tax code">
          <SmartForm
            columns={2}
            submitLabel="Create code"
            action={saveTaxCodeAction}
            fields={[
              { name: "code", label: "Code", type: "text", required: true, placeholder: "e.g. VAT-STD" },
              { name: "name", label: "Name", type: "text", required: true, placeholder: "e.g. Value added tax — standard rate" },
              {
                name: "type",
                label: "Type",
                type: "select",
                required: true,
                defaultValue: "VAT",
                options: [
                  { value: "VAT", label: TAX_TYPE_LABELS.VAT },
                  { value: "WHT", label: TAX_TYPE_LABELS.WHT },
                ],
              },
              { name: "accountCode", label: "Ledger account (optional)", type: "text", placeholder: "e.g. 2190", help: "The account the tax is booked to." },
              { name: "notes", label: "Notes", type: "textarea", span: 2 },
            ]}
          />
        </FormPanel>
      )}
    </>
  );
}
