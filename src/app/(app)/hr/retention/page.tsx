import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { retentionOverview } from "@/server/services/employee-retention";
import { ERASURE_KIND_LABELS, LEFT_STATUSES } from "@/lib/employee-retention";
import { fmtDate } from "@/lib/dates";
import { fullName } from "@/lib/utils";
import { FormPanel, PageHeader, Section, Stat, StatGrid, Empty } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { SmartForm } from "@/components/smart-form";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { approveErasureAction, rejectErasureAction, requestErasureAction, requestRetentionErasureAction } from "@/app/actions/employee-retention";

export default async function RetentionPage() {
  const ctx = await requirePage("hr.view");
  const manage = can(ctx.role, "hr.manage");
  const approve = can(ctx.role, "hr.approve");
  const { years, due, waiting, requests } = await retentionOverview(ctx);
  const pending = requests.filter((r) => r.status === "PENDING");
  const leavers = manage && years > 0 ? await db.employee.findMany({ where: { organizationId: ctx.orgId, status: { in: [...LEFT_STATUSES] }, anonymizedAt: null }, orderBy: { employeeNumber: "asc" }, select: { id: true, employeeNumber: true, firstName: true, middleName: true, lastName: true } }) : [];
  return (
    <>
      <PageHeader
        title="Records retention"
        description={
          years > 0
            ? `Tax and pension rules oblige the company to keep a former employee's records for ${years} year${years === 1 ? "" : "s"} after they leave. Until then nothing can be erased, whoever asks. After it, their personal details can be removed: name, date of birth, contact and bank, tax and pension details, the people they listed, the text of their documents, letters, disciplinary and exit records, case notes, appraisal comments, any job application and their login. The employee number, dates and every pay and leave figure stay, because the business and the tax authority still need them and they identify no one without a name. One person asks, a different person approves, and approving carries it out; it can't be undone.`
            : "Switched off. Set how many years former employees' records must be kept under Settings → HR & Lifecycle Policy → Data retention to use this page. Until then nothing can be erased."
        }
      />
      {years > 0 && (
        <StatGrid cols={3}>
          <Stat label="Past the retention period" value={due.length} tone={due.length ? "amber" : "green"} />
          <Stat label="Still within it" value={waiting} />
          <Stat label="Waiting for approval" value={pending.length} tone={pending.length ? "amber" : "green"} />
        </StatGrid>
      )}

      {manage && years > 0 && (
        <FormPanel title="A former employee has asked for their data to be erased">
          <SmartForm
            columns={2}
            submitLabel="Send for approval"
            action={requestErasureAction}
            fields={[
              { name: "employeeId", label: "Former employee", type: "select", required: true, options: leavers.map((e) => ({ value: e.id, label: `${e.employeeNumber} — ${fullName(e)}` })), help: "Only people who have left. It is refused with the reason if the retention period hasn't passed or anything is still owed." },
              { name: "reason", label: "What was asked, when, and how you checked who asked", type: "textarea", required: true },
            ]}
          />
        </FormPanel>
      )}

      {years > 0 && (
        <Section title="Past the retention period" flush>
          <Table>
            <THead>
              <TR>
                <TH>Former employee</TH>
                <TH>Left</TH>
                <TH>Could be erased from</TH>
                <TH>Status</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {due.map((e) => (
                <TR key={e.id}>
                  <TD>
                    {e.employeeNumber} <span className="text-xs">{fullName(e)}</span>
                  </TD>
                  <TD className="text-xs">{fmtDate(e.exitDate)}</TD>
                  <TD className="text-xs">{fmtDate(e.eraseFrom)}</TD>
                  <TD className="max-w-[22rem] whitespace-normal text-xs">
                    {e.blockers.length ? (
                      <ul className="list-disc pl-4 text-muted-foreground">
                        {e.blockers.map((b) => (
                          <li key={b}>{b}</li>
                        ))}
                      </ul>
                    ) : (
                      <Badge tone="amber">Ready</Badge>
                    )}
                  </TD>
                  <TD className="text-right">
                    {manage && !e.blockers.length && (
                      <ActionButton action={requestRetentionErasureAction.bind(null, e.id)} reason reasonPlaceholder="Why (e.g. retention period over, nothing outstanding)" variant="outline">
                        Request erasure
                      </ActionButton>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          {!due.length && <Empty>No former employee is past the retention period.</Empty>}
        </Section>
      )}

      <Section title="Requests" flush>
        <Table>
          <THead>
            <TR>
              <TH>Employee</TH>
              <TH>Why</TH>
              <TH>Asked by</TH>
              <TH>Status</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {requests.map((r) => (
              <TR key={r.id}>
                <TD>
                  {r.employee.employeeNumber} <span className="text-xs">{r.employee.anonymizedAt ? "(personal details removed)" : fullName(r.employee)}</span>
                </TD>
                <TD className="max-w-[20rem] whitespace-normal text-xs">
                  <Badge tone="gray">{ERASURE_KIND_LABELS[r.kind]}</Badge>
                  <div className="mt-1 text-muted-foreground">{r.reason}</div>
                </TD>
                <TD className="text-xs">
                  {r.requestedBy}
                  <div className="text-muted-foreground">{fmtDate(r.createdAt)}</div>
                </TD>
                <TD className="max-w-[18rem] whitespace-normal text-xs">
                  <StatusBadge status={r.status} />
                  {r.decidedBy && (
                    <div className="mt-1 text-muted-foreground">
                      {r.decidedBy}, {fmtDate(r.decidedAt)}
                      {r.decisionNote ? ` — ${r.decisionNote}` : ""}
                    </div>
                  )}
                  {r.summary && typeof r.summary === "object" && (
                    <div className="mt-1 text-muted-foreground">
                      Removed or cleared:{" "}
                      {Object.entries(r.summary as Record<string, number>)
                        .filter(([, n]) => n > 0)
                        .map(([k, n]) => `${n} ${k}`)
                        .join(", ")}
                    </div>
                  )}
                </TD>
                <TD className="space-x-1 whitespace-nowrap text-right">
                  {approve && r.status === "PENDING" && r.requestedByUserId !== ctx.userId && (
                    <>
                      <ActionButton action={approveErasureAction.bind(null, r.id)} confirm="Remove this person's personal details for good? This can't be undone." variant="success">
                        Approve and erase
                      </ActionButton>
                      <ActionButton action={rejectErasureAction.bind(null, r.id)} reason reasonPlaceholder="Why it is being turned down" variant="outline">
                        Turn down
                      </ActionButton>
                    </>
                  )}
                  {r.status === "PENDING" && r.requestedByUserId === ctx.userId && <span className="text-xs text-muted-foreground">Waiting for someone else</span>}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!requests.length && <Empty>No erasure requests.</Empty>}
      </Section>
    </>
  );
}
