import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { fmtDate } from "@/lib/dates";
import { BusinessError } from "@/server/services/_base";
import { getHandover, listAcceptors } from "@/server/services/sales/handover";
import { PageHeader, Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { acceptHandoverAction, returnHandoverAction } from "@/app/actions/sales-handover";
import { HandoverForm, type FormState } from "./handover-form";

const money = (s: unknown) => `₦${Number(s).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");
const TONE = { DRAFT: undefined, RETURNED: "red", SUBMITTED: "amber", ACCEPTED: "green" } as const;

export default async function HandoverPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("sales.view");
  const { id } = await params;
  let h;
  try {
    h = await getHandover(ctx, id);
  } catch (e) {
    if (e instanceof BusinessError) notFound();
    throw e;
  }
  const [deal, account, categories, acceptors] = await Promise.all([
    db.crmOpportunity.findUniqueOrThrow({ where: { id: h.opportunityId }, select: { id: true, name: true } }),
    db.crmAccount.findUniqueOrThrow({ where: { id: h.accountId }, select: { name: true, clientId: true } }),
    db.employeeCategory.findMany({ where: { organizationId: ctx.orgId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    listAcceptors(ctx),
  ]);
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const editable = can(ctx.role, "sales.manage") && (h.status === "DRAFT" || h.status === "RETURNED");
  const maker = [h.preparedByUserId, h.submittedByUserId].includes(ctx.userId);
  const isAcceptor = h.status === "SUBMITTED" && can(ctx.role, "sales.handover.accept") && acceptors.some((a) => a.userId === ctx.userId) && !maker;
  const clients = isAcceptor ? await db.client.findMany({ where: { organizationId: ctx.orgId }, orderBy: { name: "asc" }, select: { id: true, code: true, name: true } }) : [];
  const initial: FormState = {
    scope: h.scope ?? "",
    clientRequirements: h.clientRequirements ?? "",
    startDate: h.startDate ? h.startDate.toISOString().slice(0, 10) : "",
    termMonths: h.termMonths ? String(h.termMonths) : "",
    noSpecialSla: h.noSpecialSla,
    serviceLevels: h.serviceLevels.map((s) => ({ obligation: s.obligation, measure: s.measure ?? "", consequence: s.consequence ?? "" })),
    sites: h.sites.map((s) => ({
      id: s.id, name: s.name, address: s.address ?? "", state: s.state ?? "", lga: s.lga ?? "", contactName: s.contactName ?? "", contactRole: s.contactRole ?? "", contactPhone: s.contactPhoneE164 ?? "", contactEmail: s.contactEmail ?? "",
      noEquipment: s.noEquipment, equipment: s.equipment.map((e) => ({ item: e.item, quantity: String(e.quantity) })),
      posts: s.posts.map((p) => ({ id: p.id, label: p.postLabel ?? "Post", summary: `${p.headcount} billed, ${p.requiredPersonnel} needed to cover the shifts${p.shiftPattern ? `, ${p.shiftPattern}` : ""}, ${money(p.billPerHead)} each`, categoryId: p.categoryId ?? "" })),
    })),
  };

  return (
    <>
      <PageHeader title={`Handover ${h.number}`} crumbs={[{ href: `/sales/opportunities/${deal.id}`, label: deal.name }]} description={`${account.name}. From quote ${h.quoteNumber}, version ${h.quoteVersion}. Prepared by ${h.preparedBy}.`} />
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Badge tone={TONE[h.status]}>{label(h.status)}</Badge>
        <span>Monthly bill {money(h.monthlyBill)}</span>
        {h.validUntil && <span className="text-muted-foreground">quote open until {fmtDate(h.validUntil)}</span>}
        {h.status === "ACCEPTED" && h.clientId && (
          <>
            <Link className="underline" href={`/clients/${h.clientId}`}>The client</Link>
            <span className="text-muted-foreground">and a draft contract were made by {h.acceptedBy}</span>
          </>
        )}
      </div>

      {h.status === "RETURNED" && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-900">Operations ({h.returnedBy}) sent this back with a question: {h.returnNote}</p>}
      {h.status === "SUBMITTED" && <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-900">Sent to Operations by {h.submittedBy}. It cannot be changed until Operations accepts or returns it. Nothing exists in Operations yet.</p>}
      {h.status === "DRAFT" && <p className="rounded bg-muted px-3 py-2 text-sm">Started when the client accepted the quote. Nothing exists in Operations until it has been completed, sent, and accepted there.</p>}

      <Section title="Agreed in the quote (copied in, never changes)" flush>
        <Table>
          <THead>
            <TR>
              <TH>Site and post</TH>
              <TH>Shift</TH>
              <TH className="text-right">Guards billed</TH>
              <TH className="text-right">People needed</TH>
              <TH className="text-right">Bill rate each</TH>
            </TR>
          </THead>
          <TBody>
            {h.sites.flatMap((s) =>
              s.posts.map((p) => (
                <TR key={p.id}>
                  <TD className="whitespace-normal text-xs">{s.name}{p.postLabel ? `, ${p.postLabel}` : ""}</TD>
                  <TD className="text-xs">{p.shiftPattern ?? "—"}</TD>
                  <TD className="text-right">{p.headcount}</TD>
                  <TD className="text-right">{p.requiredPersonnel}</TD>
                  <TD className="text-right">{money(p.billPerHead)}</TD>
                </TR>
              )),
            )}
          </TBody>
        </Table>
      </Section>

      {editable ? (
        <>
          {h.missing.length > 0 && (
            <Section title={`Still needed (${h.missing.length})`} description="Everything here must be done before the handover can be sent to Operations. Save to refresh this list.">
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {h.missing.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </Section>
          )}
          <Section title="What Sales enters">
            <HandoverForm id={h.id} initial={initial} categories={categories} canSend={can(ctx.role, "sales.manage")} complete={h.missing.length === 0} />
          </Section>
        </>
      ) : (
        <>
          <Section title="Scope, requirements and term">
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <div className="sm:col-span-2"><dt className="text-muted-foreground">Scope of service</dt><dd className="whitespace-pre-wrap">{h.scope}</dd></div>
              <div className="sm:col-span-2"><dt className="text-muted-foreground">The client&apos;s requirements</dt><dd className="whitespace-pre-wrap">{h.clientRequirements}</dd></div>
              <div><dt className="text-muted-foreground">Start date</dt><dd>{h.startDate ? fmtDate(h.startDate) : "—"}</dd></div>
              <div><dt className="text-muted-foreground">Term</dt><dd>{h.termMonths ? `${h.termMonths} months` : "—"}</dd></div>
            </dl>
          </Section>
          <Section title="Special service-level obligations" flush={h.serviceLevels.length > 0}>
            {h.noSpecialSla || !h.serviceLevels.length ? (
              <p className="text-sm text-muted-foreground">{h.noSpecialSla ? "None." : "Not entered."}</p>
            ) : (
              <Table>
                <THead><TR><TH>Obligation</TH><TH>Time or measure</TH><TH>Consequence if missed</TH></TR></THead>
                <TBody>
                  {h.serviceLevels.map((s, i) => (
                    <TR key={i}><TD className="whitespace-normal">{s.obligation}</TD><TD>{s.measure ?? "—"}</TD><TD className="whitespace-normal">{s.consequence ?? "—"}</TD></TR>
                  ))}
                </TBody>
              </Table>
            )}
          </Section>
          {h.sites.map((s) => (
            <Section key={s.id} title={`Site: ${s.name}`}>
              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <div className="sm:col-span-2"><dt className="text-muted-foreground">Address</dt><dd>{[s.address, s.lga, s.state].filter(Boolean).join(", ") || "—"}</dd></div>
                <div><dt className="text-muted-foreground">The client&apos;s site contact</dt><dd>{[s.contactName, s.contactRole ? `(${s.contactRole})` : null].filter(Boolean).join(" ") || "—"}</dd></div>
                <div><dt className="text-muted-foreground">Contact phone and email</dt><dd>{[s.contactPhoneE164, s.contactEmail].filter(Boolean).join(", ") || "—"}</dd></div>
                <div className="sm:col-span-2"><dt className="text-muted-foreground">Equipment</dt><dd>{s.noEquipment ? "None needed." : s.equipment.map((e) => `${e.quantity} x ${e.item}`).join(", ") || "—"}</dd></div>
                <div className="sm:col-span-2"><dt className="text-muted-foreground">Employee category of each post</dt><dd>{s.posts.map((p) => `${p.postLabel ?? "Post"}: ${p.categoryId ? (catName.get(p.categoryId) ?? "unknown") : "not chosen"}`).join("; ")}</dd></div>
              </dl>
            </Section>
          ))}
        </>
      )}

      {isAcceptor && (
        <Section title="Operations: accept or return" description="Accepting makes the client (or links the one you choose), a DRAFT contract, one rate for each employee category and a site for each site above, all together. Nothing is made if any step fails. Returning sends it back to Sales with your question.">
          <div className="space-y-6">
            <SmartForm
              columns={2}
              submitLabel="Accept the handover"
              action={acceptHandoverAction}
              resetOnSuccess={false}
              fields={[
                { name: "id", label: "", type: "hidden", defaultValue: h.id },
                {
                  name: "existingClientId",
                  label: account.clientId ? "Client (the account is already linked to one)" : "Client",
                  type: "select",
                  options: [{ value: "", label: account.clientId ? "The account's own client" : "Make a new client" }, ...clients.map((c) => ({ value: c.id, label: `${c.code}: ${c.name}` }))],
                },
                { name: "note", label: "Note (optional)", span: 2 },
              ]}
            />
            <SmartForm columns={2} submitLabel="Return to Sales with a question" resetOnSuccess={false} action={returnHandoverAction} fields={[{ name: "id", label: "", type: "hidden", defaultValue: h.id }, { name: "note", label: "Your question", required: true, span: 2 }]} />
          </div>
        </Section>
      )}
      {h.status === "SUBMITTED" && !isAcceptor && can(ctx.role, "sales.handover.accept") && (
        <p className="text-sm text-muted-foreground">
          {maker ? "You prepared or sent this handover, so someone else in Operations must accept or return it." : "Only a designated person in Operations can accept or return it. The company administrator designates them under Sales Settings."}
        </p>
      )}

      <Section title="History" flush>
        <Table>
          <THead><TR><TH>When</TH><TH>What</TH><TH>Who</TH><TH>Note</TH></TR></THead>
          <TBody>
            {h.events.map((e) => (
              <TR key={e.id}>
                <TD className="text-xs">{fmtDate(e.at)}</TD>
                <TD>{label(e.kind)} (revision {e.revisionNo})</TD>
                <TD>{e.byName}</TD>
                <TD className="whitespace-normal text-xs">{e.note ?? ""}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Section>
    </>
  );
}
