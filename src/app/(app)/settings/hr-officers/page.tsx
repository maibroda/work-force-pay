import { requirePage } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { HR_FUNCTIONS, HR_FUNCTION_LABELS } from "@/lib/hr-functions";
import { listOfficers, unheldFunctionsFor } from "@/server/services/hr-officers";
import { fmtDate } from "@/lib/dates";
import { Empty, FormPanel, PageHeader, Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { ActionButton } from "@/components/action-button";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { appointOfficerAction, grantFunctionAction, removeOfficerAction, revokeFunctionAction } from "@/app/actions/hr-officers";

/** Settings > HR officers: only the Company Administrator (and platform staff) can open this page. The HR administrator cannot, so nobody can grant themselves a function. */
export default async function HrOfficersPage() {
  const ctx = await requirePage("hr.officer.manage");
  const [officers, unheld, candidates] = await Promise.all([
    listOfficers(ctx),
    unheldFunctionsFor(ctx),
    // someone who is not an administrator: create them first under Users (an outsourced person needs no employee record), then appoint them here
    db.user.findMany({ where: { organizationId: ctx.orgId, active: true, role: "EMPLOYEE" }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" } }),
  ]);
  const live = officers.filter((o) => o.active);
  return (
    <>
      <PageHeader
        title="HR officers"
        description="A Delegated HR Officer can do nothing in HR until you grant one or more of four functions: welfare cases, surveys, assisted survey sessions and succession. Each grant needs a reason, can have an end date, and can be revoked at once. An outsourced officer needs an end date and must sign in with two-factor. The HR administrator cannot appoint officers or grant functions."
      />
      {unheld.length > 0 && (
        <Section title="Nobody holds these functions">
          <p className="text-sm">
            {unheld.map((f) => HR_FUNCTION_LABELS[f]).join(", ")}. Until an HR administrator or an officer holds a function, its records cannot be read by anyone.
          </p>
        </Section>
      )}
      <FormPanel title="Appoint an officer">
        <SmartForm
          columns={3}
          submitLabel="Appoint"
          action={appointOfficerAction}
          fields={[
            { name: "userId", label: "User (create them under Users first)", type: "select", required: true, options: candidates.map((u) => ({ value: u.id, label: `${u.name} (${u.email})` })), span: 2 },
            { name: "external", label: "Outsourced (not an employee of the company)", type: "checkbox" },
            { name: "accessEndsOn", label: "Last day they can sign in (required if outsourced)", type: "date" },
          ]}
        />
      </FormPanel>
      {live.length > 0 && (
        <FormPanel title="Grant a function">
          <SmartForm
            columns={3}
            submitLabel="Grant"
            action={grantFunctionAction}
            fields={[
              { name: "userId", label: "Officer", type: "select", required: true, options: live.map((o) => ({ value: o.id, label: o.name })) },
              { name: "function", label: "Function", type: "select", required: true, options: HR_FUNCTIONS.map((f) => ({ value: f, label: HR_FUNCTION_LABELS[f] })) },
              { name: "endsOn", label: "Ends on (optional)", type: "date" },
              { name: "reason", label: "Why", required: true, span: 3 },
            ]}
          />
        </FormPanel>
      )}
      <Section title={`${officers.length} officer(s)`} flush>
        {officers.length === 0 ? (
          <Empty>No Delegated HR Officer yet.</Empty>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Officer</TH>
                <TH>Kind</TH>
                <TH>Access ends</TH>
                <TH>Functions</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {officers.map((o) => (
                <TR key={o.id}>
                  <TD>
                    {o.name}
                    <div className="text-xs text-muted-foreground">{o.email}</div>
                    {!o.active && <Badge tone="gray">ended</Badge>}
                  </TD>
                  <TD className="text-xs">{o.external ? "Outsourced" : "Company"}</TD>
                  <TD className="text-xs">{o.accessEndsOn ? fmtDate(o.accessEndsOn) : "—"}</TD>
                  <TD className="text-xs">
                    {o.grants.length === 0 ? (
                      "None: no access"
                    ) : (
                      <ul className="space-y-1">
                        {o.grants.map((g) => (
                          <li key={g.id} className="flex flex-wrap items-center gap-2">
                            <Badge tone="blue">{HR_FUNCTION_LABELS[g.function]}</Badge>
                            <span className="text-muted-foreground">
                              granted by {g.grantedBy} on {fmtDate(g.grantedAt)}
                              {g.endsOn ? `, until ${fmtDate(g.endsOn)}` : ""}: {g.reason}
                            </span>
                            <ActionButton action={revokeFunctionAction.bind(null, g.id)} reason reasonPlaceholder="Why is it being revoked?" variant="outline">
                              Revoke
                            </ActionButton>
                          </li>
                        ))}
                      </ul>
                    )}
                  </TD>
                  <TD>
                    {o.active && (
                      <ActionButton action={removeOfficerAction.bind(null, o.id)} confirm="End this appointment? Every function is revoked and the account is switched off." variant="outline">
                        End appointment
                      </ActionButton>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Section>
    </>
  );
}
