import type { Ctx } from "@/lib/auth/context";
import { can, ROLE_PERMISSIONS, type Role } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { fmtDate } from "@/lib/dates";
import { cancelTaskAction, completeTaskAction } from "@/app/actions/sales-activities";
import { timeline, tasksFor } from "@/server/services/sales/activities";
import { ActionButton } from "@/components/action-button";
import { Section } from "@/components/page";
import { ContactActions } from "./contact-actions";
import { QuickLog, type LogTarget } from "./quick-log";
import { TimelineList } from "./timeline-list";

/** The activity layer of a lead, contact, account or deal page: reach out, log what happened, the open tasks, and the timeline. */
export async function ActivityPanel({ ctx, target }: { ctx: Ctx; target: LogTarget }) {
  const manage = can(ctx.role, "sales.manage");
  const [items, tasks] = await Promise.all([timeline(ctx, target), tasksFor(ctx, target)]);

  // whom a call, WhatsApp or email on this page would be about: the contact, the lead, or the deal's primary contact
  let person: { target: LogTarget; firstName: string | null; company: string | null; phone: string | null; whatsapp: string | null; email: string | null } | null = null;
  if (manage) {
    const contactId = target.contactId ?? (target.opportunityId ? (await db.crmOpportunity.findFirst({ where: { id: target.opportunityId, organizationId: ctx.orgId }, select: { primaryContactId: true } }))?.primaryContactId ?? undefined : undefined);
    if (contactId) {
      const c = await db.crmContact.findFirst({ where: { id: contactId, organizationId: ctx.orgId, status: "ACTIVE" }, select: { id: true, firstName: true, phoneE164: true, whatsappE164: true, email: true, account: { select: { name: true } } } });
      if (c) person = { target: target.opportunityId ? { contactId: c.id, opportunityId: target.opportunityId } : { contactId: c.id }, firstName: c.firstName, company: c.account?.name ?? null, phone: c.phoneE164, whatsapp: c.whatsappE164, email: c.email };
    } else if (target.leadId) {
      const l = await db.crmLead.findFirst({ where: { id: target.leadId, organizationId: ctx.orgId, status: { in: ["NEW", "CONTACTED", "QUALIFIED", "UNQUALIFIED"] } }, select: { id: true, contactName: true, companyName: true, phoneE164: true, email: true } });
      if (l) person = { target: { leadId: l.id }, firstName: l.contactName?.split(" ")[0] ?? null, company: l.companyName, phone: l.phoneE164, whatsapp: null, email: l.email };
    }
  }
  const salesRoles = (Object.keys(ROLE_PERMISSIONS) as Role[]).filter((r) => can(r, "sales.manage"));
  const people = can(ctx.role, "sales.view.all") && manage ? await db.user.findMany({ where: { organizationId: ctx.orgId, active: true, role: { in: salesRoles as never } }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : [];

  return (
    <>
      {person && (person.phone || person.whatsapp || person.email) && (
        <Section title="Reach out" description="Calling or opening WhatsApp logs it first. A marketing message goes only to someone whose marketing consent is granted; a service message is only for someone at a client.">
          <ContactActions p={{ ...person, sender: ctx.name.split(" ")[0] }} />
        </Section>
      )}
      {manage && (
        <Section title="Log something or add a task">
          <QuickLog target={target} managers={people.filter((p) => p.id !== ctx.userId)} />
        </Section>
      )}
      <Section title={`${tasks.length} open task(s)`} flush>
        {tasks.length ? (
          <ul className="divide-y text-sm">
            {tasks.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-2">
                <span className="font-medium">{t.title}</span>
                <span className="text-xs text-muted-foreground">due {fmtDate(t.dueAt)}, {t.ownerName}</span>
                {manage && (
                  <>
                    <ActionButton action={completeTaskAction.bind(null, { id: t.id })} variant="outline">Done</ActionButton>
                    <ActionButton action={cancelTaskAction.bind(null, { id: t.id })} variant="outline" confirm="Cancel this task?">Cancel</ActionButton>
                  </>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-4 text-sm text-muted-foreground">No open tasks.</p>
        )}
      </Section>
      <Section title="Timeline">
        <TimelineList canVoid={manage} rows={items.map((i) => ({ id: i.id, type: i.type, at: i.at.toISOString(), title: i.title, detail: i.detail ?? null, by: i.by ?? null, voided: !!i.voided }))} />
      </Section>
    </>
  );
}
