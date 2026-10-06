import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { listRequests } from "@/server/services/data-requests";
import { getHrPolicy, todayUtc } from "@/server/services/hr-policy";
import { DUE_STATE_LABELS } from "@/lib/data-requests";
import { fmtDate, iso } from "@/lib/dates";
import { fullName } from "@/lib/utils";
import { FormPanel, PageHeader, Section, Stat, StatGrid, Empty } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { SmartForm } from "@/components/smart-form";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { completeRequestAction, openRequestAction, refuseRequestAction, verifyIdentityAction } from "@/app/actions/data-requests";

const tone = { OVERDUE: "red", DUE_SOON: "amber", ON_TRACK: "green", DONE: "gray" } as const;
const CHANNELS = ["Email", "Letter", "In person", "Phone", "Through a lawyer or representative"].map((c) => ({ value: c, label: c }));

export default async function DataRequestsPage() {
  const ctx = await requirePage("hr.view");
  const manage = can(ctx.role, "hr.manage");
  const [rows, policy, employees] = await Promise.all([
    listRequests(ctx),
    getHrPolicy(ctx.orgId),
    manage ? db.employee.findMany({ where: { organizationId: ctx.orgId }, orderBy: { employeeNumber: "asc" }, select: { id: true, employeeNumber: true, firstName: true, middleName: true, lastName: true, status: true } }) : Promise.resolve([]),
  ]);
  const open = rows.filter((r) => r.status === "OPEN");
  return (
    <>
      <PageHeader
        title="Data access requests"
        description={`Anyone the company holds data about can ask for a copy of it. Log the request here, check who they are, then generate their data — a file covering everything held on them, built on the spot and never stored. The answer is due ${policy.dsarResponseDays} days after the request is received (Settings → HR & Lifecycle Policy). Employees can also download their own data any time under My Data.`}
      />
      <StatGrid cols={3}>
        <Stat label="Open requests" value={open.length} tone={open.length ? "amber" : "green"} />
        <Stat label="Due within 7 days" value={open.filter((r) => r.state === "DUE_SOON").length} tone={open.some((r) => r.state === "DUE_SOON") ? "amber" : "green"} />
        <Stat label="Overdue" value={open.filter((r) => r.state === "OVERDUE").length} tone={open.some((r) => r.state === "OVERDUE") ? "red" : "green"} />
      </StatGrid>

      {manage && (
        <FormPanel title="Log a request" open={!rows.length}>
          <SmartForm
            columns={2}
            submitLabel="Log request"
            action={openRequestAction}
            fields={[
              { name: "employeeId", label: "Whose data", type: "select", required: true, options: employees.map((e) => ({ value: e.id, label: `${e.employeeNumber} — ${fullName(e)}${["EXITED", "TERMINATED", "RESIGNED"].includes(e.status) ? " (left)" : ""}` })) },
              { name: "requesterName", label: "Who made the request", required: true, help: "The person themselves, or whoever is acting for them." },
              { name: "channel", label: "How it arrived", type: "select", options: CHANNELS },
              { name: "receivedOn", label: "Received on", type: "date", required: true, defaultValue: iso(todayUtc()), help: "The deadline counts from this day." },
            ]}
          />
        </FormPanel>
      )}

      <Section title="Requests" flush>
        <Table>
          <THead>
            <TR>
              <TH>Request</TH>
              <TH>Employee</TH>
              <TH>Asked by</TH>
              <TH>Due</TH>
              <TH>Identity</TH>
              <TH>Status</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.id}>
                <TD className="font-mono text-xs">{r.requestNumber}</TD>
                <TD>
                  {r.employee.employeeNumber} <span className="text-xs">{fullName(r.employee)}</span>
                </TD>
                <TD className="text-xs">
                  {r.requesterName}
                  <div className="text-muted-foreground">
                    {r.channel ? `${r.channel}, ` : ""}received {fmtDate(r.receivedOn)}
                  </div>
                </TD>
                <TD className="text-xs">
                  {fmtDate(r.dueOn)}
                  <div>
                    <Badge tone={tone[r.state]}>{DUE_STATE_LABELS[r.state]}</Badge>
                    {r.status === "OPEN" && <span className="ml-1 text-muted-foreground">{r.daysLeft < 0 ? `${-r.daysLeft} day(s) late` : `${r.daysLeft} day(s) left`}</span>}
                  </div>
                </TD>
                <TD className="max-w-[14rem] whitespace-normal text-xs">
                  {r.identityVerified ? (
                    <>
                      <Badge tone="green">Checked</Badge>
                      <div className="text-muted-foreground">
                        {r.verifiedBy}: {r.identityNote}
                      </div>
                    </>
                  ) : (
                    <Badge tone="amber">Not checked</Badge>
                  )}
                </TD>
                <TD className="max-w-[16rem] whitespace-normal text-xs">
                  <StatusBadge status={r.status} />
                  {r.exportedAt && <div className="mt-1 text-muted-foreground">Data generated {fmtDate(r.exportedAt)}</div>}
                  {r.completedOn && (
                    <div className="mt-1 text-muted-foreground">
                      {r.handledBy}, {fmtDate(r.completedOn)}
                      {r.refusalReason ? ` — ${r.refusalReason}` : r.completionNote ? ` — ${r.completionNote}` : ""}
                    </div>
                  )}
                </TD>
                <TD className="space-x-1 whitespace-nowrap text-right">
                  {manage && r.status === "OPEN" && (
                    <>
                      {!r.identityVerified && (
                        <ActionButton action={verifyIdentityAction.bind(null, r.id)} reason reasonPlaceholder="How you checked who they are" variant="outline">
                          Check identity
                        </ActionButton>
                      )}
                      {r.identityVerified && r.canExport && (
                        <a className="text-xs text-primary underline" href={`/api/data-requests/${r.id}/export`}>
                          Generate &amp; download data
                        </a>
                      )}
                      {r.exportedAt && (
                        <ActionButton action={completeRequestAction.bind(null, r.id)} confirm="Mark this request complete? Do it once the person has been given their data." variant="success">
                          Complete
                        </ActionButton>
                      )}
                      <ActionButton action={refuseRequestAction.bind(null, r.id)} reason reasonPlaceholder="Why it can't be met (the person may be told)" variant="outline">
                        Refuse
                      </ActionButton>
                    </>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!rows.length && <Empty>No requests logged.</Empty>}
      </Section>
    </>
  );
}
