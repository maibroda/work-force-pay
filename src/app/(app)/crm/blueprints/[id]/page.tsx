import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { fmtDate } from "@/lib/dates";
import { MODULES, type ModuleKey } from "@/lib/entitlements/catalogue";
import type { Configured } from "@/lib/entitlements/configure";
import type { Quote } from "@/lib/entitlements/pricing";
import { BusinessError } from "@/server/services/_base";
import { getBlueprint } from "@/server/services/blueprints";
import { isSeller } from "@/server/services/price-book";
import { ActionButton } from "@/components/action-button";
import { KV, PageHeader, Section } from "@/components/page";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { provisionBlueprintAction, setBlueprintStatusAction } from "@/app/actions/blueprints";

const name = (k: string) => MODULES[k as ModuleKey]?.name ?? k;
const names = (ks: string[]) => (ks.length ? ks.map(name).join(", ") : "none");
const NEXT: Record<string, string[]> = { DRAFT: ["SENT", "DROPPED"], SENT: ["ACCEPTED", "DROPPED"], ACCEPTED: [], DROPPED: [] };
const LABEL: Record<string, string> = { SENT: "Mark as sent", ACCEPTED: "Mark as accepted", DROPPED: "Drop" };

export default async function BlueprintPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("blueprint.manage");
  const { id } = await params;
  if (!(await isSeller(ctx))) return <PageHeader title="Blueprint" description="Blueprints and quotes are made in a payroll bureau's own organization, or by platform staff." />;
  const b = await getBlueprint(ctx, id).catch((e) => {
    if (e instanceof BusinessError) notFound();
    throw e;
  });
  // applying changes the client's modules: subscription work, for platform staff and a bureau's administrator (the service checks it again)
  const canApply = b.status === "ACCEPTED" && !b.provisionedAt && !!b.leadId && (can(ctx.role, "subscription.manage") || can(ctx.role, "bureau.manage"));
  const c = b.configured as unknown as Configured;
  const q = b.quote as unknown as Quote | null;
  return (
    <>
      <PageHeader
        title={b.prospectName}
        crumbs={[{ href: "/crm/blueprints", label: "Blueprints and quotes" }]}
        description={`Saved ${fmtDate(b.createdAt)} by ${b.createdBy}. The quote is as it was given on that day: a later price change does not change it.`}
        actions={
          <>
            {NEXT[b.status]?.map((s) => (
              <ActionButton key={s} action={setBlueprintStatusAction.bind(null, b.id, s as never)} confirm={s === "DROPPED" ? "Drop this blueprint? It cannot be reopened." : undefined} variant={s === "DROPPED" ? "outline" : undefined}>
                {LABEL[s]}
              </ActionButton>
            ))}
            {canApply && (
              <>
                <ActionButton action={provisionBlueprintAction.bind(null, b.id, false)} confirm="Apply this blueprint to the client? Its plan, add-ons and limits become the client's subscription.">
                  Apply to the client
                </ActionButton>
                <ActionButton action={provisionBlueprintAction.bind(null, b.id, true)} confirm="Apply it although the client has work in progress in a module that would end? That work stays readable but can no longer be worked." variant="outline">
                  Apply, acknowledging work in progress
                </ActionButton>
              </>
            )}
          </>
        }
      />
      <Section title="Summary">
        <KV
          cols={4}
          items={[
            ["Status", <StatusBadge key="s" status={b.status === "SENT" ? "ISSUED" : b.status === "ACCEPTED" ? "APPROVED" : b.status === "DROPPED" ? "CANCELLED" : "DRAFT"} />],
            ["Lead", b.leadId ? <Link key="l" className="underline" href={`/crm/leads/${b.leadId}`}>Open the lead</Link> : "None"],
            ["Employees", c.limits?.employeeLimit ?? "—"],
            ["Sales users", c.limits?.crmUserLimit ?? "—"],
          ]}
        />
        <p className="mt-3 text-xs text-muted-foreground">Sending and accepting are only recorded here: the app sends nothing. Once accepted, and its lead has become a client, it can be applied to that client.</p>
        {b.provisionedAt && <p className="mt-2 text-sm">Applied to the client on {fmtDate(b.provisionedAt)}: its plan, add-ons and limits became the client&apos;s subscription.</p>}
      </Section>
      <Section title="The plan proposed">
        {c.proposed ? (
          <div className="space-y-2 text-sm">
            <p>
              <b>{c.proposed.planName}</b>. {c.proposed.why}
            </p>
            {c.runnerUp && <p className="text-muted-foreground">Runner-up: {c.runnerUp.why}</p>}
            <p>
              <b>Modules:</b> {names((b.modules as string[]).filter((m) => m !== "core"))} (and the core platform, always on).
            </p>
            {c.reasons.length > 0 && (
              <ul className="list-disc pl-5">
                {c.reasons.map((r) => (
                  <li key={r.module}>{r.because}</li>
                ))}
              </ul>
            )}
            {c.notes.length > 0 && (
              <ul className="list-disc pl-5 text-amber-800">
                {c.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </Section>
      <Section title="The quote" description={q?.priceBookFrom ? `From the price book that started on ${q.priceBookFrom}.` : undefined} flush={!!q?.lines?.length}>
        {!q ? (
          <p className="text-sm text-muted-foreground">No quote was saved with this blueprint.</p>
        ) : (
          <div className="text-sm">
            {q.lines.length > 0 && (
              <Table>
                <THead>
                  <TR>
                    <TH>Module</TH>
                    <TH>Price</TH>
                    <TH>Quantity</TH>
                    <TH>Per month</TH>
                  </TR>
                </THead>
                <TBody>
                  {q.lines.map((l) => (
                    <TR key={l.moduleKey}>
                      <TD>{l.name}</TD>
                      <TD>
                        {l.unitPrice} {l.basis === "flat" ? "flat" : l.basis === "crm_user" ? "per user" : "per employee"}
                      </TD>
                      <TD>{l.quantity ?? "—"}</TD>
                      <TD>{l.monthly}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
            <div className="p-4">
              {q.ok ? (
                <KV
                  cols={4}
                  items={[
                    ["Subtotal", `${q.currency} ${q.subtotal}`],
                    ["Minimum monthly fee", q.minimumApplied ? `${q.minimumMonthly} (applied)` : q.minimumMonthly],
                    ["Per month", <b key="m">{`${q.currency} ${q.monthly}`}</b>],
                    ["VAT", q.vat ? `${q.vat} at ${q.vatRatePct}%, ${q.monthlyWithVat} in all` : "No VAT rate known"],
                  ]}
                />
              ) : (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900">
                  <b>No total.</b> {q.reasons.join(" ")}
                </div>
              )}
            </div>
          </div>
        )}
      </Section>
    </>
  );
}
