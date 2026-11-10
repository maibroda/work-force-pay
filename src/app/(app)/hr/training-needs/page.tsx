import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { NEED_SOURCES, NEED_SOURCE_LABELS, NEED_STATUS_LABELS, sameCourse, type NeedSource, type NeedStatus } from "@/lib/training-plan";
import { STATE_LABELS, type ComplianceState } from "@/lib/training-compliance";
import { listNeeds, listSessions, trainingGaps } from "@/server/services/training-plan";
import { fmtDate, fmtShort, iso } from "@/lib/dates";
import { fullName } from "@/lib/utils";
import { Empty, FormPanel, PageHeader, Section } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { SmartForm } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { addNeedAction, addNeedFromGapAction, dropNeedAction, enrolEmployeeAction } from "@/app/actions/training-plan";

export default async function TrainingNeedsPage() {
  const ctx = await requirePage("hr.view");
  const manage = can(ctx.role, "hr.manage");
  const [needs, gaps, sessions] = await Promise.all([listNeeds(ctx, {}), trainingGaps(ctx), listSessions(ctx, { status: "SCHEDULED" })]);
  const today = iso(new Date());
  const coming = sessions.filter((s) => iso(s.sessionDate) >= today && s.seatsLeft > 0);
  const sessionsFor = (course: string) => coming.filter((s) => sameCourse(s.programme.name, course)).slice(0, 3);
  const live = needs.filter((n) => n.status === "OPEN" || n.status === "PLANNED");
  const done = needs.filter((n) => n.status === "MET" || n.status === "DROPPED").slice(0, 30);
  return (
    <>
      <PageHeader
        title="Training needs"
        description="Who needs which course, and what is waiting for a session. A need is added by a person (from a compliance gap, an appraisal recommendation, a request or anything else), never automatically. It becomes Enrolled when the person is put on a session and Met when they attend."
      />

      <Section title={`Required courses missing or expired, with no session yet (${gaps.length})`} description="From the compliance check. Add someone to the training needs, or enrol them straight onto a coming session of that course." flush>
        {gaps.length === 0 ? (
          <Empty>Everyone who needs a required course is covered or already enrolled.</Empty>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Employee</TH>
                <TH>Course</TH>
                <TH>Where it stands</TH>
                {manage && <TH>Actions</TH>}
              </TR>
            </THead>
            <TBody>
              {gaps.slice(0, 200).map((g) => (
                <TR key={`${g.employee.id}|${g.courseName}`}>
                  <TD>
                    {fullName(g.employee)}
                    <div className="text-xs text-muted-foreground">{g.employee.employeeNumber}</div>
                  </TD>
                  <TD>{g.courseName}</TD>
                  <TD>
                    <Badge tone="red">{STATE_LABELS[g.state as ComplianceState]}</Badge> {g.hasNeed && <Badge tone="blue">on the needs list</Badge>}
                  </TD>
                  {manage && (
                    <TD>
                      <div className="flex flex-wrap gap-1">
                        {!g.hasNeed && (
                          <ActionButton action={addNeedFromGapAction.bind(null, g.employee.id, g.courseName)} variant="outline">
                            Add to needs
                          </ActionButton>
                        )}
                        {sessionsFor(g.courseName).map((s) => (
                          <ActionButton key={s.id} action={enrolEmployeeAction.bind(null, s.id, g.employee.id)} confirm={`Enrol ${fullName(g.employee)} on ${fmtDate(s.sessionDate)}?`} variant="success">
                            Enrol {fmtShort(s.sessionDate)}
                          </ActionButton>
                        ))}
                      </div>
                    </TD>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Section>

      {manage && (
        <FormPanel title="Record a training need">
          <SmartForm
            columns={3}
            submitLabel="Record need"
            action={addNeedAction}
            fields={[
              { name: "employeeNumber", label: "Employee number", required: true, placeholder: "e.g. EMP-000012" },
              { name: "courseName", label: "Course", required: true },
              { name: "source", label: "Why", type: "select", options: NEED_SOURCES.filter((s) => s !== "COMPLIANCE" && s !== "APPRAISAL").map((s) => ({ value: s, label: NEED_SOURCE_LABELS[s] })) },
              { name: "priority", label: "Priority", type: "select", options: [{ value: "HIGH", label: "High" }, { value: "NORMAL", label: "Normal" }, { value: "LOW", label: "Low" }] },
              { name: "dueBy", label: "Needed by", type: "date" },
              { name: "note", label: "Note", span: 3 },
            ]}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            A need for a course from an appraisal that recommended training is added from that appraisal. Courses are run from the <Link className="text-primary underline" href="/hr/training-calendar">Training calendar</Link>.
          </p>
        </FormPanel>
      )}

      <Section title={`Open and enrolled needs (${live.length})`} flush>
        {live.length === 0 ? (
          <Empty>No open needs.</Empty>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Employee</TH>
                <TH>Course</TH>
                <TH>Why</TH>
                <TH>Status</TH>
                {manage && <TH>Actions</TH>}
              </TR>
            </THead>
            <TBody>
              {live.map((n) => (
                <TR key={n.id}>
                  <TD>
                    {fullName(n.employee)}
                    <div className="text-xs text-muted-foreground">{n.employee.employeeNumber}</div>
                  </TD>
                  <TD>
                    {n.courseName}
                    {n.dueBy && <div className="text-xs text-muted-foreground">needed by {fmtDate(n.dueBy)}</div>}
                  </TD>
                  <TD className="max-w-xs whitespace-normal text-xs">
                    {NEED_SOURCE_LABELS[n.source as NeedSource]}
                    {n.priority === "HIGH" && <Badge tone="amber" className="ml-1">high</Badge>}
                    {n.note && <div className="text-muted-foreground">{n.note}</div>}
                  </TD>
                  <TD>
                    <Badge tone={n.status === "PLANNED" ? "blue" : "amber"}>{NEED_STATUS_LABELS[n.status as NeedStatus]}</Badge>
                  </TD>
                  {manage && (
                    <TD>
                      <div className="flex flex-wrap gap-1">
                        {n.status === "OPEN" &&
                          sessionsFor(n.courseName).map((s) => (
                            <ActionButton key={s.id} action={enrolEmployeeAction.bind(null, s.id, n.employeeId)} confirm={`Enrol ${fullName(n.employee)} on ${fmtDate(s.sessionDate)}?`} variant="success">
                              Enrol {fmtShort(s.sessionDate)}
                            </ActionButton>
                          ))}
                        <ActionButton action={dropNeedAction.bind(null, n.id)} reason reasonPlaceholder="Why is it dropped? (required)" variant="outline">
                          Drop
                        </ActionButton>
                      </div>
                    </TD>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Section>

      {done.length > 0 && (
        <Section title="Recently met or dropped" flush>
          <Table>
            <TBody>
              {done.map((n) => (
                <TR key={n.id}>
                  <TD>
                    {fullName(n.employee)} <span className="text-xs text-muted-foreground">{n.employee.employeeNumber}</span>
                  </TD>
                  <TD>{n.courseName}</TD>
                  <TD>
                    <Badge tone={n.status === "MET" ? "green" : "gray"}>{NEED_STATUS_LABELS[n.status as NeedStatus]}</Badge>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Section>
      )}
    </>
  );
}
