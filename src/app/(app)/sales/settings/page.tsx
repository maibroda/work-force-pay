import { requirePage } from "@/lib/auth/session";
import { can, ROLE_PERMISSIONS, type Role } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { getAssignment } from "@/server/services/sales/assignment";
import { listAcceptors } from "@/server/services/sales/handover";
import { getMinimumMargin, listApprovers } from "@/server/services/sales/quotes";
import { getSalesSetting } from "@/server/services/sales/setting";
import { ActionButton } from "@/components/action-button";
import { PageHeader, Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { removeAssignmentRuleAction, saveSalesSettingAction, setAssignmentMethodAction, setAssignmentRuleAction } from "@/app/actions/sales";
import { designateAcceptorAction, removeAcceptorAction } from "@/app/actions/sales-handover";
import { designateApproverAction, removeApproverAction, setMinimumMarginAction } from "@/app/actions/sales-quotes";

const SERVICES = ["GUARDING", "CLEANING", "FACILITY", "STAFFING", "OTHER"];
const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");

export default async function SalesSettingsPage() {
  const ctx = await requirePage("sales.configure");
  const s = await getSalesSetting(ctx);
  const assignment = await getAssignment(ctx);
  const minimum = s.enabled ? await getMinimumMargin(ctx) : null;
  const approvers = s.enabled ? await listApprovers(ctx) : [];
  const managerRoles = (Object.keys(ROLE_PERMISSIONS) as Role[]).filter((r) => can(r, "sales.manage") && can(r, "sales.view.all"));
  const managers = s.enabled ? await db.user.findMany({ where: { organizationId: ctx.orgId, active: true, role: { in: managerRoles as never } }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : [];
  const acceptors = s.enabled ? await listAcceptors(ctx) : [];
  const acceptRoles = (Object.keys(ROLE_PERMISSIONS) as Role[]).filter((r) => can(r, "sales.handover.accept"));
  const opsPeople = s.enabled ? await db.user.findMany({ where: { organizationId: ctx.orgId, active: true, role: { in: acceptRoles as never } }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : [];
  const salesRoles = (Object.keys(ROLE_PERMISSIONS) as Role[]).filter((r) => can(r, "sales.manage"));
  const people = await db.user.findMany({ where: { organizationId: ctx.orgId, active: true, role: { in: salesRoles as never } }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  return (
    <>
      <PageHeader
        title="Sales settings"
        description="The sales module keeps this company's own prospects, contacts and enquiries. It is off until you switch it on, and switching it off again keeps everything already entered."
      />
      <Section title="Status">
        <p className="text-sm">{s.enabled ? <Badge tone="green">On</Badge> : <Badge>Off</Badge>}</p>
      </Section>
      <Section
        title="Switch and mode"
        description="Classic: every enquiry is a lead first, and a real one is converted into an account, contact and deal. Simple: enquiries go straight to deals (for a small team where every enquiry is real); leads are then not used."
      >
        <SmartForm
          columns={2}
          submitLabel="Save"
          action={saveSalesSettingAction}
          fields={[
            { name: "enabled", label: "Sales module is on", type: "checkbox", defaultValue: s.enabled },
            {
              name: "mode",
              label: "Mode",
              type: "select",
              defaultValue: s.mode,
              options: [
                { value: "CLASSIC", label: "Classic (leads first)" },
                { value: "SIMPLE", label: "Simple (straight to deals)" },
              ],
            },
          ]}
        />
      </Section>

      {s.enabled && minimum && (
        <Section title="Minimum margin on quotes" description="The lowest gross margin (a share of what the client is billed) a quote may have. A quote below it cannot be sent to the client until a designated approver (below), who did not make it, approves it with a reason. A new organization starts at 15%. 0 means no minimum.">
          <SmartForm columns={2} submitLabel="Save minimum" action={setMinimumMarginAction} fields={[{ name: "percent", label: "Minimum margin %", type: "number", defaultValue: minimum.percent }]} />
        </Section>
      )}

      {s.enabled && minimum && (
        <>
          <Section title={`${approvers.length} designated approver(s)`} description="Only these people can approve a quote below the minimum margin, and never their own quote. If nobody is designated, no such quote can be sent. Only an active sales manager can be designated." flush>
            <Table>
              <THead><TR><TH>Approver</TH><TH>Designated by</TH><TH /></TR></THead>
              <TBody>
                {approvers.map((a) => (
                  <TR key={a.id}>
                    <TD>{a.userName}</TD>
                    <TD className="text-xs">{a.designatedBy}</TD>
                    <TD><ActionButton action={removeApproverAction.bind(null, a.id)} confirm="Remove this approver?" variant="outline">Remove</ActionButton></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            {!approvers.length && <p className="px-4 py-4 text-sm text-amber-800">Nobody is designated yet, so no quote below the minimum can be approved or sent.</p>}
          </Section>
          <Section title="Designate an approver">
            <SmartForm columns={2} submitLabel="Designate" resetOnSuccess action={designateApproverAction} fields={[{ name: "userId", label: "Sales manager", type: "select", required: true, options: [{ value: "", label: "— choose —" }, ...managers.map((m) => ({ value: m.id, label: m.name }))] }]} />
          </Section>
        </>
      )}

      {s.enabled && (
        <>
          <Section title={`${acceptors.length} designated to accept handovers`} description="When a client accepts a quote, Sales prepares a handover and Operations must accept it before the client, a draft contract, its rates and the sites are made. Only these people (the Executive Director, Operations, or the Operations Manager) can accept or return one, and never one they prepared." flush>
            <Table>
              <THead><TR><TH>Person</TH><TH>Designated by</TH><TH /></TR></THead>
              <TBody>
                {acceptors.map((a) => (
                  <TR key={a.id}>
                    <TD>{a.userName}</TD>
                    <TD className="text-xs">{a.designatedBy}</TD>
                    <TD><ActionButton action={removeAcceptorAction.bind(null, a.id)} confirm="Remove this person? They will no longer be able to accept handovers." variant="outline">Remove</ActionButton></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            {!acceptors.length && <p className="px-4 py-4 text-sm text-amber-800">Nobody is designated yet, so no handover can be accepted.</p>}
          </Section>
          <Section title="Designate someone to accept handovers">
            <SmartForm columns={2} submitLabel="Designate" resetOnSuccess action={designateAcceptorAction} fields={[{ name: "userId", label: "Person in Operations", type: "select", required: true, options: [{ value: "", label: "— choose —" }, ...opsPeople.map((m) => ({ value: m.id, label: m.name }))] }]} />
          </Section>
        </>
      )}

      {s.enabled && (
        <>
          <Section
            title="Who new leads go to"
            description="Applies when a manager adds a lead without naming an owner (and, later, to imported leads). A sales person always owns what they add themselves. Where no rule fits, the person adding it keeps it. Every assignment is recorded."
          >
            <SmartForm
              columns={2}
              submitLabel="Save method"
              action={setAssignmentMethodAction}
              fields={[
                {
                  name: "method",
                  label: "Method",
                  type: "select",
                  defaultValue: assignment.method,
                  options: [
                    { value: "NONE", label: "None: the person adding it keeps it" },
                    { value: "ROUND_ROBIN", label: "Round robin: each active sales person in turn" },
                    { value: "BY_STATE", label: "By the lead's state (rules below)" },
                    { value: "BY_SERVICE", label: "By the service wanted (rules below)" },
                  ],
                },
              ]}
            />
          </Section>
          <Section title={`${assignment.rules.length} assignment rule(s)`} flush>
            <Table>
              <THead>
                <TR>
                  <TH>When</TH>
                  <TH>Goes to</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {assignment.rules.map((r) => (
                  <TR key={r.id}>
                    <TD>
                      {r.kind === "STATE" ? "State" : "Service"}: {r.kind === "STATE" ? r.key : label(r.key)}
                    </TD>
                    <TD>{r.userName}</TD>
                    <TD>
                      <ActionButton action={removeAssignmentRuleAction.bind(null, r.id)} confirm="Remove this rule?" variant="outline">
                        Remove
                      </ActionButton>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            {!assignment.rules.length && <p className="px-4 py-4 text-sm text-muted-foreground">No rules yet.</p>}
          </Section>
          <Section title="Add or change a rule" description="A rule for a state or service that already has one replaces it. State names are not case sensitive.">
            <SmartForm
              columns={3}
              submitLabel="Save rule"
              resetOnSuccess
              action={setAssignmentRuleAction}
              fields={[
                { name: "kind", label: "Rule is about", type: "select", defaultValue: "STATE", options: [{ value: "STATE", label: "A state (type it below)" }, { value: "SERVICE", label: "A service (type it exactly: " + SERVICES.join(", ") + ")" }] },
                { name: "key", label: "State, or service in capitals", required: true },
                { name: "userId", label: "Goes to", type: "select", required: true, options: [{ value: "", label: "— choose —" }, ...people.map((p) => ({ value: p.id, label: p.name }))] },
              ]}
            />
          </Section>
        </>
      )}
    </>
  );
}
