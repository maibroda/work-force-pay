import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { listBreaches } from "@/server/services/breaches";
import { ASSESSMENT_LABELS, DATA_CATEGORIES, describeHours, NOTIFY_STATE_LABELS } from "@/lib/breaches";
import { fmtDate, iso } from "@/lib/dates";
import { FormPanel, PageHeader, Section, Stat, StatGrid, Empty } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { reportBreachAction } from "@/app/actions/breaches";

const tone = { OVERDUE: "red", DUE_SOON: "amber", RUNNING: "amber", LATE: "red", ON_TIME: "green", NOT_REQUIRED: "gray" } as const;

export default async function BreachesPage() {
  const ctx = await requirePage("hr.view");
  const manage = can(ctx.role, "hr.manage");
  const { rows, hours, contactNamed } = await listBreaches(ctx);
  const open = rows.filter((r) => r.status === "OPEN");
  const now = new Date();
  return (
    <>
      <PageHeader
        title="Data breaches"
        description={`Log every personal-data breach — lost laptops, a payroll file emailed to the wrong person, someone looking at records they shouldn't. When a breach is likely to put people at risk the regulator must be told within ${hours} hours of the company becoming aware, so the clock starts at discovery, not at assessment (Settings → HR & Lifecycle Policy). Breaches with no risk are still recorded here.`}
      />
      {!contactNamed && (
        <div className="mb-5 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <b>Nobody is named as the data protection contact.</b> Set one, the regulator details and your breach procedure under Settings → HR &amp; Lifecycle Policy → Data protection contact, so that whoever picks up a breach out of hours knows who to call.
        </div>
      )}
      <StatGrid cols={4}>
        <Stat label="Open breaches" value={open.length} tone={open.length ? "amber" : "green"} />
        <Stat label="Not assessed yet" value={open.filter((r) => r.assessment === "UNASSESSED").length} tone={open.some((r) => r.assessment === "UNASSESSED") ? "amber" : "green"} />
        <Stat label="Regulator notice due soon" value={open.filter((r) => r.state === "DUE_SOON").length} tone={open.some((r) => r.state === "DUE_SOON") ? "amber" : "green"} />
        <Stat label="Regulator notice overdue" value={open.filter((r) => r.state === "OVERDUE").length} tone={open.some((r) => r.state === "OVERDUE") ? "red" : "green"} />
      </StatGrid>

      {manage && (
        <FormPanel title="Log a breach" open={!rows.length}>
          <SmartForm
            columns={2}
            submitLabel="Log breach"
            action={reportBreachAction}
            fields={[
              { name: "title", label: "What happened, in a line", required: true, span: 2 },
              { name: "description", label: "Details", type: "textarea", required: true, span: 2, help: "What data, how it got out, who may have seen it. Facts only — you can add to this later." },
              { name: "discoveredDate", label: "Company became aware on", type: "date", required: true, defaultValue: iso(now), help: "The deadline counts from this moment." },
              { name: "discoveredTime", label: "At (hours:minutes, optional)", help: `Leave blank for the start of the day. Now is ${now.toISOString().slice(11, 16)} UTC.` },
              { name: "occurredOn", label: "It happened on (if known)", type: "date" },
              { name: "individualsAffected", label: "People affected (best estimate)", type: "number", min: 0 },
              ...DATA_CATEGORIES.map((c, i) => ({ name: `cat_${i}`, label: c, type: "checkbox" as const, defaultValue: false })),
            ]}
          />
        </FormPanel>
      )}

      <Section title="Register" flush>
        <Table>
          <THead>
            <TR>
              <TH>Breach</TH>
              <TH>Became aware</TH>
              <TH>Assessment</TH>
              <TH>Regulator</TH>
              <TH>Status</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((b) => (
              <TR key={b.id}>
                <TD className="max-w-[22rem] whitespace-normal">
                  <Link className="text-primary underline" href={`/hr/breaches/${b.id}`}>
                    {b.incidentNumber}
                  </Link>{" "}
                  {b.title}
                  <div className="text-xs text-muted-foreground">{b.individualsAffected !== null ? `${b.individualsAffected} ${b.individualsAffected === 1 ? "person" : "people"} affected` : "People affected not yet known"}</div>
                </TD>
                <TD className="text-xs">{fmtDate(b.discoveredAt)}</TD>
                <TD className="text-xs">
                  <Badge tone={b.assessment === "UNASSESSED" ? "amber" : b.assessment === "NO_RISK" ? "gray" : "red"}>{ASSESSMENT_LABELS[b.assessment]}</Badge>
                </TD>
                <TD className="text-xs">
                  <Badge tone={tone[b.state]}>{NOTIFY_STATE_LABELS[b.state]}</Badge>
                  {b.status === "OPEN" && (b.state === "RUNNING" || b.state === "DUE_SOON" || b.state === "OVERDUE") && (
                    <div className="text-muted-foreground">{b.hoursLeft < 0 ? `${describeHours(b.hoursLeft)} past the deadline` : `${describeHours(b.hoursLeft)} left`}</div>
                  )}
                </TD>
                <TD>
                  <StatusBadge status={b.status} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!rows.length && <Empty>No breaches logged.</Empty>}
      </Section>
    </>
  );
}
