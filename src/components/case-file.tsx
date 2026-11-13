import Link from "next/link";
import type { Ctx } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { canCtx } from "@/lib/hr-functions";
import { closeAdvice, type getCase } from "@/server/services/relations";
import { db } from "@/lib/db";
import { enumOptions } from "@/server/options";
import { fmtDate } from "@/lib/dates";
import { fullName } from "@/lib/utils";
import { FormPanel, KV, PageHeader, Section, Empty } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { SmartForm } from "@/components/smart-form";
import { Badge, StatusBadge } from "@/components/ui/badge";
import {
  addCaseNoteAction,
  assignCaseAction,
  closeCaseAction,
  issueSanctionAction,
  reopenCaseAction,
  resolveCaseAction,
  setCaseStatusAction,
} from "@/app/actions/hr-lifecycle";
import { addWelfareNoteAction, assignWelfareAction, closeWelfareAction, resolveWelfareAction, setWelfareStatusAction } from "@/app/actions/welfare";

const OPEN = ["OPEN", "INVESTIGATING", "HEARING"];

/**
 * One case file, shown under Employee relations or under Disciplinary (misconduct). The server enforces who may do what;
 * the flags here only decide which buttons to show. A misconduct case needs the disciplinary permission as well as the HR one.
 */
export async function CaseFile({ ctx, c, welfare = false }: { ctx: Ctx; c: Awaited<ReturnType<typeof getCase>>; welfare?: boolean }) {
  const misconduct = c.type === "MISCONDUCT";
  const disciplinary = !misconduct || can(ctx.role, "discipline.manage");
  // the welfare lane (src/app/(app)/hr/welfare-cases): the welfare permission alone is enough, and the welfare actions are used; elsewhere nothing changes
  const lane = welfare && c.type === "WELFARE" && canCtx(ctx, "welfare.manage");
  const manage = lane || (can(ctx.role, "hr.manage") && disciplinary);
  const approve = lane || (can(ctx.role, "hr.approve") && disciplinary);
  const reopen = can(ctx.role, "hr.approve") && disciplinary;
  const A = lane
    ? { note: addWelfareNoteAction, assign: assignWelfareAction, status: setWelfareStatusAction, resolve: resolveWelfareAction, close: closeWelfareAction }
    : { note: addCaseNoteAction, assign: assignCaseAction, status: setCaseStatusAction, resolve: resolveCaseAction, close: closeCaseAction };
  const isOpen = OPEN.includes(c.status);
  // governance step 2b: the person who resolved a case does not also close it, unless nobody else could (then they give a reason)
  const advice = approve && c.status === "RESOLVED" ? await closeAdvice(ctx, c.id) : { blocked: false, needsReason: false };
  const staff = manage
    ? await db.user.findMany({
        where: { organizationId: ctx.orgId, active: true, role: { in: ["HR_ADMIN", "HR_OFFICER", "COMPANY_ADMIN", "SUPER_ADMIN"] } },
        orderBy: { name: "asc" },
      })
    : [];
  const overdue = isOpen && c.dueDate && c.dueDate < new Date();
  const canSanction =
    manage && can(ctx.role, "discipline.manage") && (c.outcome === "SUBSTANTIATED" || c.outcome === "PARTIALLY_SUBSTANTIATED") && !(c.selfRaised && c.type === "GRIEVANCE");
  return (
    <>
      <PageHeader
        title={`${c.caseNumber} — ${c.redacted ? "Confidential case" : c.summary}`}
        crumbs={[lane ? { href: "/hr/welfare-cases", label: "Welfare cases" } : misconduct ? { href: "/hr/discipline", label: "Disciplinary" } : { href: "/hr/relations", label: "Employee relations" }]}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={c.status} /> {c.type.replace(/_/g, " ").toLowerCase()} · <StatusBadge status={c.severity} />
            {c.confidential && <Badge tone="violet">confidential</Badge>}
            {overdue && <Badge tone="red">past resolution target</Badge>}
          </span>
        }
        actions={
          <>
            {manage && c.status === "OPEN" && (
              <ActionButton action={A.status.bind(null, c.id, "INVESTIGATING")} variant="outline">
                Start investigation
              </ActionButton>
            )}
            {manage && c.status === "INVESTIGATING" && (
              <ActionButton action={A.status.bind(null, c.id, "HEARING")} variant="outline">
                Move to hearing
              </ActionButton>
            )}
            {manage && c.status === "HEARING" && (
              <ActionButton action={A.status.bind(null, c.id, "INVESTIGATING")} variant="outline">
                Back to investigation
              </ActionButton>
            )}
            {approve && c.status === "RESOLVED" && advice.blocked && <span className="self-center text-xs text-muted-foreground">You resolved this case, so a different person closes it.</span>}
            {approve && c.status === "RESOLVED" && !advice.blocked && (
              <ActionButton action={A.close.bind(null, c.id)} reason={advice.needsReason} reasonPlaceholder="You resolved this case and you are the only person who can close it: why? (at least 20 characters)" variant="success">
                Sign off & close
              </ActionButton>
            )}
            {reopen && (c.status === "RESOLVED" || c.status === "CLOSED") && (
              <ActionButton action={reopenCaseAction.bind(null, c.id)} reason reasonPlaceholder="Appeal / new evidence — why re-open?" variant="outline">
                Re-open
              </ActionButton>
            )}
          </>
        }
      />

      {c.redacted ? (
        <Section title="Restricted">
          <p className="text-sm text-muted-foreground">
            This is a confidential case. Its description, case file and outcome are visible only to HR managers.
          </p>
        </Section>
      ) : (
        <>
          <Section title="Case">
            <KV
              cols={4}
              items={[
                ["Employee", <Link key="e" className="text-primary underline" href={`/employees/${c.employeeId}`}>{c.employee.employeeNumber} — {fullName(c.employee)}</Link>],
                ["Raised by", `${c.raisedBy}${c.selfRaised ? " (the employee)" : ""} · ${fmtDate(c.openedAt)}`],
                ["Assigned to", c.assignedTo ?? "Unassigned"],
                ["Resolution target", fmtDate(c.dueDate)],
                ["Outcome", c.outcome ? <StatusBadge key="o" status={c.outcome} /> : "—"],
                ["Closed", c.closedAt ? `${fmtDate(c.closedAt)} by ${c.closedBy}` : "—"],
                ["Description", <span key="d" className="whitespace-pre-line">{c.description}</span>],
                ["Resolution", <span key="r" className="whitespace-pre-line">{c.resolution ?? "—"}</span>],
              ]}
            />
          </Section>

          <Section title={`Case file (${c.notes.length})`} description="Append-only — entries can't be edited or deleted, so the record of the investigation stays intact." flush>
            <ol className="divide-y">
              {c.notes.map((n) => (
                <li key={n.id} className="px-4 py-3 text-sm">
                  <div className="mb-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                    <Badge tone={n.kind === "DECISION" ? "green" : n.kind === "APPEAL" ? "amber" : "blue"}>{n.kind}</Badge>
                    {n.authorName} · {n.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                  </div>
                  <p className="whitespace-pre-line">{n.note}</p>
                </li>
              ))}
            </ol>
            {!c.notes.length && <Empty>Nothing on the file yet.</Empty>}
          </Section>

          {c.disciplinaryRecords.length > 0 && (
            <Section title="Sanctions raised from this case" flush>
              <ul className="divide-y text-sm">
                {c.disciplinaryRecords.map((d) => (
                  <li key={d.id} className="flex items-center justify-between px-4 py-2">
                    <span>
                      {d.type.replace(/_/g, " ").toLowerCase()} — {d.actionTaken}
                    </span>
                    <StatusBadge status={d.status} />
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {manage && c.status !== "CLOSED" && (
            <FormPanel title="Add to the case file">
              <SmartForm
                columns={3}
                submitLabel="Add entry"
                action={A.note.bind(null, c.id)}
                fields={[
                  { name: "kind", label: "Kind", type: "select", defaultValue: "NOTE", options: enumOptions(["NOTE", "INVESTIGATION", "HEARING", "EVIDENCE", "DECISION", "APPEAL"]) },
                  { name: "note", label: "Entry", type: "textarea", required: true, span: 3 },
                ]}
              />
            </FormPanel>
          )}
          {manage && isOpen && (
            <div className="grid gap-5 lg:grid-cols-2">
              <FormPanel title="Assign">
                <SmartForm
                  columns={1}
                  submitLabel="Assign"
                  action={A.assign.bind(null, c.id)}
                  fields={[{ name: "assignedTo", label: "Handled by", type: "select", required: true, defaultValue: c.assignedTo ?? "", options: staff.map((u) => ({ value: u.name, label: `${u.name} (${u.role.replace(/_/g, " ").toLowerCase()})` })) }]}
                />
              </FormPanel>
              <FormPanel title="Resolve">
                <SmartForm
                  columns={1}
                  submitLabel="Resolve case"
                  action={A.resolve.bind(null, c.id)}
                  fields={[
                    { name: "outcome", label: "Finding", type: "select", required: true, options: enumOptions(["SUBSTANTIATED", "PARTIALLY_SUBSTANTIATED", "UNSUBSTANTIATED", "RESOLVED_INFORMALLY", "WITHDRAWN"]) },
                    { name: "resolution", label: "What was found and decided", type: "textarea", required: true },
                  ]}
                />
              </FormPanel>
            </div>
          )}
          {canSanction && (
            <FormPanel title="Issue a sanction from this finding">
              <SmartForm
                columns={3}
                submitLabel="Raise sanction"
                action={issueSanctionAction.bind(null, c.id)}
                fields={[
                  { name: "type", label: "Sanction", type: "select", required: true, options: enumOptions(["QUERY", "VERBAL_WARNING", "WRITTEN_WARNING", "SUSPENSION", "TERMINATION_RECOMMENDATION"]) },
                  { name: "actionTaken", label: "Action taken", required: true, span: 2 },
                ]}
              />
            </FormPanel>
          )}
        </>
      )}
    </>
  );
}
