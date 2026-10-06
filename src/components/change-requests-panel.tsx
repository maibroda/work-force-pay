import type { Ctx } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { FIELD_LABELS, KIND_FIELDS, KIND_LABELS, type ChangeKindName } from "@/lib/change-control";
import { fmtDate } from "@/lib/dates";
import { currentDetails, employeeChanges } from "@/server/services/change-requests";
import { approveChangeAction, cancelChangeAction, rejectChangeAction, requestChangeAction } from "@/app/actions/change-requests";
import { ActionButton } from "@/components/action-button";
import { Empty, FormPanel, KV, Section } from "@/components/page";
import { SmartForm, type Field } from "@/components/smart-form";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

const KINDS: ChangeKindName[] = ["BANK", "TAX", "PENSION"];
const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));

function formFields(kind: ChangeKindName, current: Record<string, unknown>): Field[] {
  const v = (k: string) => (current[k] == null ? undefined : (current[k] as string | number));
  const byKind: Record<ChangeKindName, Field[]> = {
    BANK: [
      { name: "bankName", label: "Bank", required: true, defaultValue: v("bankName") },
      { name: "accountNumber", label: "Account number (10 digits)", required: true, pattern: "^\\d{10}$", patternMessage: "Account number must be 10 digits", defaultValue: v("accountNumber") },
      { name: "accountName", label: "Account name", required: true, defaultValue: v("accountName"), help: "Must be the employee's own account." },
    ],
    TAX: [
      { name: "taxId", label: "Tax ID", defaultValue: v("taxId") },
      { name: "annualRent", label: "Declared annual rent (₦)", type: "number", min: 0, defaultValue: v("annualRent") },
    ],
    PENSION: [
      { name: "pensionPin", label: "Pension PIN", defaultValue: v("pensionPin") },
      { name: "pfa", label: "PFA", defaultValue: v("pfa") },
    ],
  };
  return [...byKind[kind], { name: "reason", label: "Why is this changing?", required: true, span: 2, placeholder: "e.g. employee moved to a new bank" }];
}

/** What a request changes: each field, before → after. */
function Diff({ kind, previous, proposed }: { kind: ChangeKindName; previous: Record<string, unknown>; proposed: Record<string, unknown> }) {
  return (
    <ul className="space-y-0.5 text-xs">
      {KIND_FIELDS[kind].map((f) => {
        const changed = show(previous[f]) !== show(proposed[f]);
        return (
          <li key={f} className={changed ? "" : "text-muted-foreground"}>
            <span className="text-muted-foreground">{FIELD_LABELS[f]}:</span> {show(previous[f])} {changed && <>→ <b>{show(proposed[f])}</b></>}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * An employee's bank, tax and pension details and every change request on them: pending ones to approve,
 * reject or cancel, the forms to request a change, and the history. Used on the employee page (HR) and on
 * My Bank & Tax Details (self-service).
 */
export async function ChangeRequestsPanel({ ctx, employeeId, selfService = false }: { ctx: Ctx; employeeId: string; selfService?: boolean }) {
  const [cur, requests] = await Promise.all([currentDetails(ctx, employeeId), employeeChanges(ctx, employeeId)]);
  const canRequest = selfService || can(ctx.role, "employee.manage");
  const canDecide = !selfService && can(ctx.role, "employee.approve") && ctx.employeeId !== employeeId;
  const pending = requests.filter((r) => r.status === "PENDING");
  const pendingKinds = new Set(pending.map((r) => r.kind));
  return (
    <>
      <Section title="On file" description="Changes to these take effect only when someone other than the person who asked approves them.">
        <KV
          cols={3}
          items={[
            ["Bank", show(cur.BANK.bankName)],
            ["Account number", show(cur.BANK.accountNumber)],
            ["Account name", show(cur.BANK.accountName)],
            ["Tax ID", show(cur.TAX.taxId)],
            ["Declared annual rent", cur.TAX.annualRent == null ? "—" : `₦${Number(cur.TAX.annualRent).toLocaleString()}`],
            ["Pension PIN / PFA", `${show(cur.PENSION.pensionPin)} / ${show(cur.PENSION.pfa)}`],
          ]}
        />
      </Section>

      {pending.length > 0 && (
        <Section title="Waiting for approval" flush>
          <Table>
            <THead>
              <TR>
                <TH>Change</TH>
                <TH>Requested by</TH>
                <TH>Reason</TH>
                <TH>Checks</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {pending.map((r) => (
                <TR key={r.id}>
                  <TD>
                    <b className="text-xs">{KIND_LABELS[r.kind]}</b>
                    <Diff kind={r.kind} previous={r.previous as Record<string, unknown>} proposed={r.proposed as Record<string, unknown>} />
                  </TD>
                  <TD className="text-xs">
                    {r.requestedBy}
                    <div className="text-muted-foreground">{fmtDate(r.createdAt)}</div>
                  </TD>
                  <TD className="max-w-xs whitespace-normal text-xs">{r.reason}</TD>
                  <TD className="space-y-1 text-xs">
                    {r.nameMatches === false && <Badge tone="amber">Account name doesn&apos;t match the employee</Badge>}
                    {r.nameMatches === true && <Badge tone="green">Account name matches</Badge>}
                    {r.clash && <Badge tone="red">Already on {r.clash}</Badge>}
                  </TD>
                  <TD className="space-x-1 whitespace-nowrap text-right">
                    {canDecide && r.requestedByUserId !== ctx.userId && (
                      <>
                        <ActionButton action={approveChangeAction.bind(null, r.id)} confirm="Approve this change? The employee's details will be updated now." variant="success">
                          Approve
                        </ActionButton>
                        <ActionButton action={rejectChangeAction.bind(null, r.id)} reason variant="outline">
                          Reject
                        </ActionButton>
                      </>
                    )}
                    {r.requestedByUserId === ctx.userId && (
                      <ActionButton action={cancelChangeAction.bind(null, r.id)} confirm="Cancel this request?" variant="outline">
                        Cancel
                      </ActionButton>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Section>
      )}

      {canRequest &&
        KINDS.map((k) => (
          <FormPanel key={k} title={`Request a change to ${KIND_LABELS[k].toLowerCase()}`}>
            {pendingKinds.has(k) ? (
              <p className="text-sm text-muted-foreground">There is already a pending request for this — approve, reject or cancel it first.</p>
            ) : (
              <SmartForm columns={2} submitLabel="Request change" resetOnSuccess={false} action={requestChangeAction.bind(null, employeeId, k)} fields={formFields(k, cur[k])} />
            )}
          </FormPanel>
        ))}

      <Section title="History" flush>
        <Table>
          <THead>
            <TR>
              <TH>Requested</TH>
              <TH>Change</TH>
              <TH>By</TH>
              <TH>Status</TH>
              <TH>Decision</TH>
            </TR>
          </THead>
          <TBody>
            {requests
              .filter((r) => r.status !== "PENDING")
              .map((r) => (
                <TR key={r.id}>
                  <TD className="text-xs">{fmtDate(r.createdAt)}</TD>
                  <TD>
                    <b className="text-xs">{KIND_LABELS[r.kind]}</b>
                    <Diff kind={r.kind} previous={r.previous as Record<string, unknown>} proposed={r.proposed as Record<string, unknown>} />
                  </TD>
                  <TD className="text-xs">{r.requestedBy}</TD>
                  <TD>
                    <StatusBadge status={r.status} />
                  </TD>
                  <TD className="max-w-xs whitespace-normal text-xs">
                    {r.decidedBy ? `${r.decidedBy}, ${fmtDate(r.decidedAt)}` : "—"}
                    {r.decisionNote && <div className="text-muted-foreground">{r.decisionNote}</div>}
                  </TD>
                </TR>
              ))}
          </TBody>
        </Table>
        {!requests.some((r) => r.status !== "PENDING") && <Empty>No past requests.</Empty>}
      </Section>
    </>
  );
}
