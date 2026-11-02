import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { myDigest, myTasks } from "@/server/services/sales/activities";
import { completeTaskAction } from "@/app/actions/sales-activities";
import { ActionButton } from "@/components/action-button";
import { PageHeader, Section } from "@/components/page";

const when = (d: Date) => d.toLocaleString("en-NG", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

type Row = Awaited<ReturnType<typeof myTasks>>["overdue"][number];

function About({ t }: { t: Row }) {
  if (t.opportunity) return <Link className="underline" href={`/sales/opportunities/${t.opportunity.id}`}>{t.opportunity.name}</Link>;
  if (t.contact) return <Link className="underline" href={`/sales/contacts/${t.contact.id}`}>{t.contact.firstName} {t.contact.lastName}</Link>;
  if (t.lead) return <Link className="underline" href={`/sales/leads/${t.lead.id}`}>{t.lead.companyName}</Link>;
  if (t.account) return <Link className="underline" href={`/sales/accounts/${t.account.id}`}>{t.account.name}</Link>;
  return null;
}

export default async function SalesTasksPage() {
  const ctx = await requirePage("sales.view");
  const manage = can(ctx.role, "sales.manage");
  const [g, digest] = await Promise.all([myTasks(ctx), myDigest(ctx)]);
  const groups: Array<[string, Row[], string?]> = [
    ["Overdue", g.overdue, "text-red-800"],
    ["Today", g.today],
    ["This week", g.thisWeek],
    ["Later", g.later],
  ];
  return (
    <>
      <PageHeader title="My tasks" description="Your open tasks by Lagos time: overdue, today, this week, later. Finishing a task on a deal counts as activity on it." />
      <Section title="Your day" description="The same list is emailed to you each morning when there is something in it.">
        {digest.empty ? (
          <p className="text-sm text-muted-foreground">Nothing is overdue or due today, and none of your deals has gone quiet.</p>
        ) : (
          <ul className="list-disc space-y-1 pl-5 text-sm">
            <li>{digest.overdue.length} overdue, {digest.today.length} due today, {digest.reminders.length} reminder(s) for today</li>
            {digest.rotting.map((r) => (
              <li key={r.id}><Link className="underline" href={`/sales/opportunities/${r.id}`}>{r.name}</Link> ({r.stage}) has had no activity for {r.daysQuiet} days</li>
            ))}
          </ul>
        )}
      </Section>
      {groups.map(([title, rows, tone]) => (
        <Section key={title} title={`${title} (${rows.length})`} flush>
          {rows.length ? (
            <ul className="divide-y text-sm">
              {rows.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-2">
                  <span className="font-medium">{t.title}</span>
                  <span className={`text-xs ${tone ?? "text-muted-foreground"}`}>due {when(t.dueAt)}</span>
                  <span className="text-xs"><About t={t} /></span>
                  {manage && <ActionButton action={completeTaskAction.bind(null, { id: t.id })} variant="outline">Done</ActionButton>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-4 text-sm text-muted-foreground">None.</p>
          )}
        </Section>
      ))}
    </>
  );
}
