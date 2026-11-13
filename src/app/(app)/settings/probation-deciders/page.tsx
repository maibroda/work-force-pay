import { requirePage } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { listDeciders } from "@/server/services/probation-workflow";
import { fmtDate } from "@/lib/dates";
import { Empty, FormPanel, PageHeader, Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { ActionButton } from "@/components/action-button";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { designateDeciderAction, revokeDeciderAction } from "@/app/actions/probation-workflow";

/** Settings > Probation deciders: only the Company Administrator (and platform staff) can open this page. The HR administrator cannot, so the people who prepare a probation decision never choose who makes it. */
export default async function ProbationDecidersPage() {
  const ctx = await requirePage("probation.designate");
  const [rows, users, departments] = await Promise.all([
    listDeciders(ctx),
    db.user.findMany({ where: { organizationId: ctx.orgId, active: true }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" } }),
    db.department.findMany({ where: { organizationId: ctx.orgId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <>
      <PageHeader
        title="Probation deciders"
        description="Who makes the final probation decision when the probation workflow is on. The Company Administrator can always decide. Designate others here, for example a department head, for one department or for all. Never the person who recommended, the HR reviewer, the probation appraisal's reviewer or signer, or the employee, whoever is designated. A revoked designation stops working on the person's next request."
      />
      <FormPanel title="Designate a decider">
        <SmartForm
          columns={3}
          submitLabel="Designate"
          action={designateDeciderAction}
          fields={[
            { name: "userId", label: "User", type: "select", required: true, options: users.map((u) => ({ value: u.id, label: `${u.name} (${u.email})` })), span: 2 },
            { name: "departmentId", label: "Only for this department (optional)", type: "select", options: departments.map((x) => ({ value: x.id, label: x.name })) },
            { name: "reason", label: "Why", required: true, span: 3 },
          ]}
        />
      </FormPanel>
      <Section title={`${rows.filter((r) => !r.revokedAt).length} designated`} flush>
        {rows.length === 0 ? (
          <Empty>Nobody is designated yet: only the Company Administrator can decide.</Empty>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Person</TH>
                <TH>Scope</TH>
                <TH>Why, and by whom</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id}>
                  <TD>
                    {r.userName}
                    <div className="text-xs text-muted-foreground">{r.email}</div>
                  </TD>
                  <TD className="text-xs">{r.departmentName ?? "All departments"}</TD>
                  <TD className="text-xs text-muted-foreground">
                    {r.reason} — {r.grantedBy}, {fmtDate(r.grantedAt)}
                  </TD>
                  <TD>
                    {r.revokedAt ? (
                      <Badge tone="gray">revoked {fmtDate(r.revokedAt)}</Badge>
                    ) : (
                      <ActionButton action={revokeDeciderAction.bind(null, r.id)} reason reasonPlaceholder="Why is it being revoked?" variant="outline">
                        Revoke
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
