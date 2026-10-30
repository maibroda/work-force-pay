import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth/session";
import { can, ROLE_PERMISSIONS, type Role } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { BusinessError } from "@/server/services/_base";
import { getCase } from "@/server/services/sales/cases";
import { addCaseNoteAction, reassignCaseAction, reopenCaseAction, resolveCaseAction, respondToCaseAction } from "@/app/actions/sales-cases";
import { PageHeader, Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");
const TONE = { OK: undefined, NONE: undefined, WARNING: "amber", BREACHED: "red", MET: "green", LATE: "red" } as const;
const when = (d: Date | null) => (d ? d.toLocaleString("en-NG", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("sales.view");
  const { id } = await params;
  let c;
  try {
    c = await getCase(ctx, id);
  } catch (e) {
    if (e instanceof BusinessError) notFound();
    throw e;
  }
  const account = await db.crmAccount.findUniqueOrThrow({ where: { id: c.accountId }, select: { id: true, name: true } });
  const manage = can(ctx.role, "sales.case.manage");
  const manager = manage && can(ctx.role, "sales.view.all");
  const roles = (Object.keys(ROLE_PERMISSIONS) as Role[]).filter((r) => can(r, "sales.case.manage"));
  const people = manager ? await db.user.findMany({ where: { organizationId: ctx.orgId, active: true, role: { in: roles as never } }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : [];
  const hidden = (v: string) => ({ name: "id", label: "", type: "hidden" as const, defaultValue: v });
  return (
    <>
      <PageHeader title={`Case ${c.number}`} crumbs={[{ href: `/sales/accounts/${account.id}`, label: account.name }]} description={`${c.subject}. Owner ${c.ownerName}. Opened by ${c.createdBy}.`} />
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Badge tone={c.status === "RESOLVED" ? "green" : undefined}>{label(c.status)}</Badge>
        <span>{label(c.priority)} priority</span>
        <span className="text-muted-foreground">{label(c.category)}</span>
        {c.reopenedCount > 0 && <Badge tone="amber">Reopened {c.reopenedCount} time(s)</Badge>}
      </div>
      {c.description && <p className="whitespace-pre-wrap text-sm">{c.description}</p>}
      <Section title="Service level">
        {c.slaPolicyId ? (
          <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">First response, due {when(c.firstResponseDueAt)} ({c.slaBusinessHoursOnly ? "business hours" : "around the clock"})</dt>
              <dd><Badge tone={TONE[c.firstResponse]}>{label(c.firstResponse)}</Badge> {c.firstRespondedAt ? `answered ${when(c.firstRespondedAt)}` : `75% at ${when(c.firstResponseWarnAt)}`}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Resolution, due {when(c.resolutionDueAt)}{c.reopenedCount ? ` (the clock restarted ${when(c.resolutionStartedAt)})` : ""}</dt>
              <dd><Badge tone={TONE[c.resolution]}>{label(c.resolution)}</Badge> {c.resolvedAt ? `resolved ${when(c.resolvedAt)}` : `75% at ${when(c.resolutionWarnAt)}`}</dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">No SLA policy applied when this case was opened, so it has no deadlines. An administrator sets policies under <Link className="underline" href="/sales/cases/settings">Case settings</Link>.</p>
        )}
      </Section>

      {manage && c.status === "OPEN" && (
        <>
          <Section title="Answer the client">
            <SmartForm columns={1} submitLabel="Record the answer" action={respondToCaseAction} fields={[hidden(c.id), { name: "note", label: "What you told the client (the first answer stops the first-response clock)", type: "textarea", required: true }]} />
          </Section>
          <Section title="Add a note or resolve">
            <div className="grid gap-6 sm:grid-cols-2">
              <SmartForm columns={1} submitLabel="Add the note" action={addCaseNoteAction} fields={[hidden(c.id), { name: "note", label: "Note", required: true }]} />
              <SmartForm columns={1} submitLabel="Resolve the case" action={resolveCaseAction} fields={[hidden(c.id), { name: "note", label: "How it was resolved", required: true }]} />
            </div>
          </Section>
        </>
      )}
      {manage && c.status === "RESOLVED" && (
        <Section title="Reopen" description="Reopening restarts the resolution clock and is counted, so a case closed early shows up.">
          <SmartForm columns={1} submitLabel="Reopen the case" action={reopenCaseAction} fields={[hidden(c.id), { name: "note", label: "Why is it being reopened?", required: true }]} />
        </Section>
      )}
      {manager && (
        <Section title="Give it to someone else">
          <SmartForm columns={2} submitLabel="Reassign" action={reassignCaseAction} fields={[hidden(c.id), { name: "userId", label: "New owner", type: "select", required: true, options: [{ value: "", label: "— choose —" }, ...people.map((p) => ({ value: p.id, label: p.name }))] }]} />
        </Section>
      )}

      <Section title="History" flush>
        <Table>
          <THead><TR><TH>When</TH><TH>What</TH><TH>Who</TH><TH>Note</TH></TR></THead>
          <TBody>
            {c.events.map((e) => (
              <TR key={e.id}>
                <TD className="text-xs">{when(e.at)}</TD>
                <TD className="text-xs">{label(e.kind)}</TD>
                <TD className="text-xs">{e.byName}</TD>
                <TD className="whitespace-normal text-xs">{e.note ?? ""}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Section>
    </>
  );
}
