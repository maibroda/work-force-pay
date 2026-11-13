import { requirePage } from "@/lib/auth/session";
import { MAX_SUCCESSORS, READINESS_LABELS, READINESS_LEVELS, type Readiness } from "@/lib/career";
import { listRoles } from "@/server/services/career";
import { successionOverview } from "@/server/services/succession";
import { otherHolders } from "@/server/services/second-person";
import { fullName } from "@/lib/utils";
import { Empty, FormPanel, PageHeader, Section } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { SmartForm } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { addSuccessionRoleAction, approveSuccessorAction, rejectSuccessorAction, removeSuccessorAction, setSuccessionRoleActiveAction, setSuccessorAction } from "@/app/actions/career";

export default async function SuccessionPage() {
  const ctx = await requirePage("succession.manage");
  const [roles, all, others] = await Promise.all([successionOverview(ctx), listRoles(ctx), otherHolders(ctx, "succession.manage")]);
  const taken = new Set(roles.map((r) => r.categoryId));
  const free = all.filter((r) => !taken.has(r.id));
  return (
    <>
      <PageHeader
        title="Succession"
        description={`Who could cover a critical role if its holder leaves. Kept by hand: up to ${MAX_SUCCESSORS} successors per role, each with how ready they are. Nothing is suggested or scored. This page is for the HR administrator alone: no employee, manager, auditor or administrator sees it, and it is never part of a person's own data.`}
      />
      {free.length > 0 && (
        <FormPanel title="Add a critical role">
          <SmartForm columns={2} submitLabel="Add the role" action={addSuccessionRoleAction} fields={[{ name: "categoryId", label: "Role", type: "select", required: true, options: free.map((r) => ({ value: r.id, label: r.name })) }]} />
        </FormPanel>
      )}
      {roles.length === 0 && (
        <Section title="No critical roles yet">
          <Empty>Add the roles the company could not easily do without.</Empty>
        </Section>
      )}
      {roles.map((r) => (
        <Section
          key={r.id}
          title={r.role}
          description={
            <span className="flex flex-wrap items-center gap-2">
              {r.holders} in the role now
              {r.leavingSoon > 0 && <Badge tone="amber">{r.leavingSoon} leaving soon</Badge>}
              {r.active ? r.covered ? <Badge tone="green">Cover: someone is ready now</Badge> : <Badge tone="red">No one ready now</Badge> : <Badge tone="gray">Switched off</Badge>}
            </span>
          }
        >
          {r.candidates.length === 0 ? (
            <Empty>No successors named.</Empty>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Successor</TH>
                  <TH>Readiness</TH>
                  <TH>Why</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {r.candidates.map((c) => (
                  <TR key={c.id}>
                    <TD>
                      {fullName(c.employee)}
                      <div className="text-xs text-muted-foreground">{c.employee.employeeNumber}</div>
                    </TD>
                    <TD>
                      {READINESS_LABELS[c.readiness as Readiness]}
                      {c.status === "PROPOSED" && <Badge tone="amber">awaiting approval</Badge>}
                    </TD>
                    <TD className="max-w-md whitespace-normal text-sm">{c.reason ?? "—"}</TD>
                    <TD>
                      {c.status === "PROPOSED" ? (
                        <div className="flex flex-wrap gap-1">
                          {c.proposedByUserId === ctx.userId && others > 0 ? (
                            <span className="self-center text-xs text-muted-foreground">You proposed this: a different person approves it.</span>
                          ) : (
                            <ActionButton action={approveSuccessorAction.bind(null, c.id)} reason={c.proposedByUserId === ctx.userId} reasonPlaceholder="You proposed this and you are the only person who can approve it: why? (at least 20 characters)" variant="success">
                              Approve
                            </ActionButton>
                          )}
                          <ActionButton action={rejectSuccessorAction.bind(null, c.id)} confirm="Reject (or withdraw) this nomination?" variant="outline">
                            {c.proposedByUserId === ctx.userId ? "Withdraw" : "Reject"}
                          </ActionButton>
                        </div>
                      ) : (
                        <ActionButton action={removeSuccessorAction.bind(null, c.id)} confirm="Remove this successor?" variant="outline">
                          Remove
                        </ActionButton>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
          {r.active && (
            <div className="mt-3">
              <SmartForm
                columns={3}
                submitLabel="Name or update a successor"
                action={setSuccessorAction.bind(null, r.id)}
                fields={[
                  { name: "employeeNumber", label: "Employee number", required: true, placeholder: "e.g. EMP-000012" },
                  { name: "readiness", label: "Readiness", type: "select", required: true, options: READINESS_LEVELS.map((l) => ({ value: l, label: READINESS_LABELS[l] })) },
                  { name: "reason", label: "One line on why (optional)" },
                  ...(others === 0
                    ? [{ name: "singleHolderReason", label: "You are the only person who keeps this list, so a second person cannot approve a new nomination: why are you adding one without? (at least 20 characters; needed only for a new successor)", span: 3 as const }]
                    : []),
                ]}
              />
            </div>
          )}
          <div className="mt-2">
            <ActionButton action={setSuccessionRoleActiveAction.bind(null, r.id, !r.active)} variant="outline">
              {r.active ? "Switch this role off" : "Switch this role on"}
            </ActionButton>
          </div>
        </Section>
      ))}
    </>
  );
}
