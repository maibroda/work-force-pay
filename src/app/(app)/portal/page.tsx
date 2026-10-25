import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { portalOverview } from "@/server/services/portal";
import { INPUT_KIND_LABELS, type InputKind } from "@/lib/payroll-calendar";
import { fmtDate } from "@/lib/dates";
import { naira } from "@/lib/money";
import { Empty, PageHeader, Section } from "@/components/page";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

const TONE = { DONE: "green", OVERDUE: "red", DUE_SOON: "amber", UPCOMING: "gray" } as const;
const WORDS = { DONE: "Done", OVERDUE: "Overdue", DUE_SOON: "Due soon", UPCOMING: "Upcoming" } as const;

export default async function PortalPage() {
  const ctx = await requirePage("portal.view");
  const o = await portalOverview(ctx);
  const waiting = o.months.filter((m) => m.approval?.awaiting);
  return (
    <>
      <PageHeader title={o.organization} description={`Your payroll${o.bureau ? `, prepared by ${o.bureau}` : ""}. What is due, what we have received from you, and the payrolls waiting for your approval.`} />

      {waiting.map((m) => (
        <div key={m.period.id} className="flex flex-wrap items-center justify-between gap-3 rounded border border-amber-300 bg-amber-50 px-4 py-3">
          <p className="text-sm">
            <b>{m.period.name}</b> is ready and waiting for your approval{m.run ? ` — ${m.run.employeeCount} employees, net pay ${naira(m.run.totalNet)}` : ""}.
          </p>
          {m.run && (
            <Link className={buttonVariants()} href={`/portal/payroll/${m.run.id}`}>
              Review and approve
            </Link>
          )}
        </div>
      ))}

      {o.months.map((m) => (
        <Section key={m.period.id} title={m.period.name} actions={m.run ? <StatusBadge status={m.run.status} /> : undefined}>
          {m.milestones.length > 0 && (
            <Table>
              <THead>
                <TR>
                  <TH>Deadline</TH>
                  <TH>Date</TH>
                  <TH>Where it stands</TH>
                </TR>
              </THead>
              <TBody>
                {m.milestones.map((x) => (
                  <TR key={x.key}>
                    <TD>{x.label}</TD>
                    <TD>{fmtDate(x.due)}</TD>
                    <TD>
                      <Badge tone={TONE[x.state]}>{WORDS[x.state]}</Badge>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
          {m.items.length > 0 && (
            <p className="mt-3 text-sm">
              <span className="font-medium">What we have from you: </span>
              {m.items.map((i) => `${INPUT_KIND_LABELS[i.kind as InputKind] ?? i.kind} (${i.status === "RECEIVED" ? "received" : i.status === "NOT_APPLICABLE" ? "not applicable" : "still needed"})`).join("; ")}
            </p>
          )}
          {m.run && ["APPROVED", "LOCKED", "PAID"].includes(m.run.status) && (
            <p className="mt-2 text-sm">
              <Link className="text-primary underline" href={`/portal/payroll/${m.run.id}`}>
                {m.approval?.awaiting ? "Review and approve" : "View this payroll"}
              </Link>
            </p>
          )}
        </Section>
      ))}
      {!o.months.length && <Empty>Nothing to show yet. Your payroll months appear here once they are set up.</Empty>}
    </>
  );
}
