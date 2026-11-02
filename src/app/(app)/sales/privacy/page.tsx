import { requirePage } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { fmtDate } from "@/lib/dates";
import { completeAccessAction, eraseForRetentionAction, eraseSubjectAction, keepLeadAction, openRequestAction, refuseRequestAction, setRetentionAction, verifyIdentityAction } from "@/app/actions/sales-privacy";
import { listRequests, RESPONSE_DAYS, retentionCandidates } from "@/server/services/sales/privacy";
import { ActionButton } from "@/components/action-button";
import { PageHeader, Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export const dynamic = "force-dynamic";

const KIND = { ACCESS: "Copy of data", ERASURE: "Erasure", RETENTION: "Retention" } as const;

/** Requests from people about their data, and old leads due for review. Only the company administrator reaches this page. */
export default async function PrivacyPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await requirePage("sales.privacy.manage");
  const { q } = await searchParams;
  const setting = await db.crmSetting.findUnique({ where: { organizationId: ctx.orgId }, select: { enabled: true, leadRetentionMonths: true } });
  if (!setting?.enabled) return <PageHeader title="Privacy" description="Switch the sales module on under Sales settings first." />;

  const term = q?.trim();
  const [requests, due, contacts, leads] = await Promise.all([
    listRequests(ctx),
    retentionCandidates(ctx),
    term && term.length >= 2
      ? db.crmContact.findMany({ where: { organizationId: ctx.orgId, erasedAt: null, OR: [{ firstName: { contains: term, mode: "insensitive" } }, { lastName: { contains: term, mode: "insensitive" } }, { email: { contains: term, mode: "insensitive" } }, { phoneE164: { contains: term } }] }, take: 10, orderBy: { lastName: "asc" }, select: { id: true, firstName: true, lastName: true, email: true, account: { select: { name: true } } } })
      : [],
    term && term.length >= 2
      ? db.crmLead.findMany({ where: { organizationId: ctx.orgId, erasedAt: null, OR: [{ number: { contains: term, mode: "insensitive" } }, { contactName: { contains: term, mode: "insensitive" } }, { companyName: { contains: term, mode: "insensitive" } }, { email: { contains: term, mode: "insensitive" } }, { phoneE164: { contains: term } }] }, take: 10, orderBy: { createdAt: "desc" }, select: { id: true, number: true, companyName: true, contactName: true } })
      : [],
  ]);
  const subjects = [
    ...contacts.map((c) => ({ value: `CONTACT:${c.id}`, label: `Contact: ${c.firstName} ${c.lastName}${c.account ? `, ${c.account.name}` : ""}${c.email ? ` (${c.email})` : ""}` })),
    ...leads.map((l) => ({ value: `LEAD:${l.id}`, label: `Lead ${l.number}: ${l.contactName ?? "no name"}, ${l.companyName}` })),
  ];

  return (
    <>
      <PageHeader
        title="Privacy"
        description={`A person may ask what you hold on them, or ask to be erased. Answer within ${RESPONSE_DAYS} days of receiving the request (the due date is shown; the period and the wording are for your lawyer to confirm). Erasing anonymises the record and keeps their email and phone on a do-not-market list as codes, never as the address.`}
      />

      <Section title="Open a request" description="Find the person first, then record who asked and when you received it.">
        <form className="mb-3 flex max-w-md gap-2" method="get">
          <input className="h-9 w-full rounded-md border bg-background px-2 text-sm" name="q" defaultValue={q ?? ""} placeholder="Name, email, phone or lead number" />
          <button className="h-9 rounded-md border px-3 text-sm" type="submit">Find</button>
        </form>
        {term ? (
          subjects.length ? (
            <SmartForm
              columns={2}
              submitLabel="Open request"
              action={openRequestAction}
              fields={[
                { name: "subject", label: "Person", type: "select", options: subjects, required: true },
                { name: "kind", label: "What they asked for", type: "select", required: true, options: [{ value: "ACCESS", label: "A copy of their data" }, { value: "ERASURE", label: "Erasure" }] },
                { name: "requesterName", label: "Who asked (as they gave it)", required: true },
                { name: "channel", label: "How it reached you (email, call, letter…)" },
                { name: "receivedOn", label: "Date received", type: "date", help: "Leave empty for today." },
              ]}
            />
          ) : (
            <p className="text-sm text-muted-foreground">No contact or lead matches that. A person already erased is not listed.</p>
          )
        ) : null}
      </Section>

      <Section title={`${requests.length} request(s)`} flush>
        {requests.length ? (
          <Table>
            <THead>
              <TR>
                <TH>No.</TH>
                <TH>Kind</TH>
                <TH>Asked by</TH>
                <TH>Received</TH>
                <TH>Due</TH>
                <TH>Status</TH>
                <TH>Do</TH>
              </TR>
            </THead>
            <TBody>
              {requests.map((r) => (
                <TR key={r.id}>
                  <TD className="font-mono text-xs">{r.number}</TD>
                  <TD>{KIND[r.kind]}</TD>
                  <TD>{r.requesterName ?? "—"}</TD>
                  <TD>{fmtDate(r.receivedOn)}</TD>
                  <TD>
                    {fmtDate(r.dueOn)} {r.overdue && <Badge tone="red">overdue</Badge>}
                  </TD>
                  <TD>
                    {r.status === "OPEN" ? (r.identityVerified ? "Open, identity checked" : "Open, identity not checked") : r.status === "COMPLETED" ? `Completed ${fmtDate(r.completedOn)}` : "Refused"}
                    {r.exportChecksum && <div className="font-mono text-[10px] text-muted-foreground">sha256 {r.exportChecksum.slice(0, 16)}…</div>}
                    {r.reviewList && Object.values(r.reviewList as Record<string, string[]>).some((x) => x.length) && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        To review for free-text mentions: {Object.entries(r.reviewList as Record<string, string[]>).filter(([, v]) => v.length).map(([k, v]) => `${v.length} ${k.replace(/([A-Z])/g, " $1").toLowerCase()}`).join(", ")}
                      </div>
                    )}
                  </TD>
                  <TD>
                    {r.status === "OPEN" && (
                      <div className="flex flex-wrap items-center gap-2">
                        {!r.identityVerified ? (
                          <ActionButton action={verifyIdentityAction.bind(null, { id: r.id })} reason reasonPlaceholder="How you checked who they are…" variant="outline">Identity checked</ActionButton>
                        ) : r.kind === "ACCESS" ? (
                          <>
                            <a className="text-sm underline" href={`/api/sales/privacy/${r.id}`}>Download their data</a>
                            {r.exportedAt && <ActionButton action={completeAccessAction.bind(null, { id: r.id })} confirm="Close this request as answered?" variant="outline">Mark answered</ActionButton>}
                          </>
                        ) : (
                          <ActionButton action={eraseSubjectAction.bind(null, { id: r.id })} reason reasonPlaceholder="Note for the record (optional detail)…" confirm="Erase this person? Their details are removed and this cannot be undone." variant="destructive">Erase</ActionButton>
                        )}
                        <ActionButton action={refuseRequestAction.bind(null, { id: r.id })} reason reasonPlaceholder="Why it is refused…" variant="outline">Refuse</ActionButton>
                      </div>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <p className="px-4 py-3 text-sm text-muted-foreground">No requests yet.</p>
        )}
      </Section>

      <Section title="How long unconverted leads are kept" description="A lead that was never converted and has had no activity for this many months is listed below for you to keep or erase. Empty means no review. Your lawyer should confirm the period.">
        <SmartForm
          columns={3}
          submitLabel="Save"
          resetOnSuccess={false}
          action={setRetentionAction}
          fields={[{ name: "months", label: "Months (1 to 120)", type: "number", min: 1, max: 120, defaultValue: setting.leadRetentionMonths ?? "" }]}
        />
      </Section>

      <Section title={due.months ? `${due.leads.length} lead(s) past ${due.months} months` : "Retention review is off"} flush>
        {due.leads.length ? (
          <Table>
            <THead>
              <TR>
                <TH>Lead</TH>
                <TH>Company</TH>
                <TH>Last touched</TH>
                <TH>Do</TH>
              </TR>
            </THead>
            <TBody>
              {due.leads.map((l) => (
                <TR key={l.id}>
                  <TD className="font-mono text-xs">{l.number}</TD>
                  <TD>{l.companyName}</TD>
                  <TD>{fmtDate(l.lastTouched)}</TD>
                  <TD>
                    <div className="flex flex-wrap items-center gap-2">
                      <ActionButton action={keepLeadAction.bind(null, { id: l.id, months: 12 })} reason reasonPlaceholder="Why keep it for another 12 months…" variant="outline">Keep 12 months</ActionButton>
                      <ActionButton action={eraseForRetentionAction.bind(null, { id: l.id })} confirm="Erase this lead? Their details are removed and this cannot be undone." variant="destructive">Erase</ActionButton>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : due.months ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">No lead is past the period.</p>
        ) : null}
      </Section>
    </>
  );
}
