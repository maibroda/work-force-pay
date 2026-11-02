import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { listNotifications } from "@/server/services/sales/automation";
import { markNotificationsReadAction } from "@/app/actions/sales-automation";
import { ActionButton } from "@/components/action-button";
import { PageHeader, Section } from "@/components/page";

const when = (d: Date) => d.toLocaleString("en-NG", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default async function SalesNotificationsPage() {
  const ctx = await requirePage("sales.view");
  const rows = await listNotifications(ctx);
  const unread = rows.filter((r) => !r.readAt).length;
  return (
    <>
      <PageHeader title="Notifications" description="Messages from the automation rules to you (the same are emailed)." />
      <Section title={`${unread} unread of ${rows.length}`}>
        {unread > 0 && <ActionButton action={markNotificationsReadAction} variant="outline">Mark all as read</ActionButton>}
        <ul className="mt-3 space-y-2 text-sm">
          {rows.map((n) => (
            <li key={n.id} className={`rounded-md border p-3 ${n.readAt ? "text-muted-foreground" : ""}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className={n.readAt ? "" : "font-semibold"}>{n.title}</span>
                <span className="text-xs">{when(n.createdAt)}</span>
                {n.href && <Link className="text-xs underline" href={n.href}>Open</Link>}
              </div>
              <p className="mt-1 whitespace-pre-wrap text-xs">{n.body}</p>
            </li>
          ))}
        </ul>
        {!rows.length && <p className="text-sm text-muted-foreground">Nothing yet.</p>}
      </Section>
    </>
  );
}
