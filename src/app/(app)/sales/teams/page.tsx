import { requirePage } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { addTeamMemberAction, closeTeamAction, createTeamAction, removeTeamMemberAction } from "@/app/actions/sales-teams";
import { listTeams, teamCandidates } from "@/server/services/sales/teams";
import { ActionButton } from "@/components/action-button";
import { PageHeader, Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export const dynamic = "force-dynamic";

const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");

/** Sales teams: who manages whom. A sales manager sees their own records and those of the people in the teams they manage; a salesperson sees only their own. */
export default async function TeamsPage() {
  const ctx = await requirePage("sales.configure");
  const setting = await db.crmSetting.findUnique({ where: { organizationId: ctx.orgId }, select: { enabled: true } });
  if (!setting?.enabled) return <PageHeader title="Teams" description="Switch the sales module on under Sales settings first." />;
  const [teams, who] = await Promise.all([listTeams(ctx), teamCandidates(ctx)]);

  return (
    <>
      <PageHeader
        title="Teams"
        description="A sales manager sees their own records and those of the people in the teams they manage; a sales rep or account manager sees only their own. A person is in one team at most. People are given the Sales Manager, Sales Rep or Account Manager role under Settings, Users."
      />
      <Section title="New team" description={who.managers.length ? "Choose the team's manager." : "No one has the Sales Manager role yet. Give it to someone under Settings, Users first."}>
        {who.managers.length > 0 && (
          <SmartForm
            columns={2}
            submitLabel="Create team"
            action={createTeamAction}
            fields={[
              { name: "name", label: "Team name", required: true, placeholder: "Lagos" },
              { name: "managerUserId", label: "Manager", type: "select", required: true, options: who.managers.map((m) => ({ value: m.id, label: m.name })) },
            ]}
          />
        )}
      </Section>

      {teams.length > 0 && who.members.length > 0 && (
        <Section title="Add a person to a team" description="Only sales reps and account managers who are in no team are listed.">
          <SmartForm
            columns={2}
            submitLabel="Add"
            action={addTeamMemberAction}
            fields={[
              { name: "teamId", label: "Team", type: "select", required: true, options: teams.map((t) => ({ value: t.id, label: t.name })) },
              { name: "userId", label: "Person", type: "select", required: true, options: who.members.map((m) => ({ value: m.id, label: `${m.name} (${label(m.role)})` })) },
            ]}
          />
        </Section>
      )}

      <Section title={`${teams.length} team(s)`} flush>
        {teams.length ? (
          <Table>
            <THead>
              <TR>
                <TH>Team</TH>
                <TH>Manager</TH>
                <TH>Members</TH>
                <TH>Do</TH>
              </TR>
            </THead>
            <TBody>
              {teams.map((t) => (
                <TR key={t.id}>
                  <TD className="font-medium">{t.name}</TD>
                  <TD>{t.managerName}</TD>
                  <TD>
                    {t.members.length ? (
                      <ul className="space-y-1">
                        {t.members.map((m) => (
                          <li key={m.userId} className="flex items-center gap-2 text-sm">
                            {m.name} <span className="text-xs text-muted-foreground">{label(m.role)}</span>
                            <ActionButton action={removeTeamMemberAction.bind(null, { teamId: t.id, userId: m.userId })} confirm={`Remove ${m.name} from ${t.name}? ${t.managerName} will no longer see their records.`} variant="outline">Remove</ActionButton>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-sm text-muted-foreground">No members yet.</span>
                    )}
                  </TD>
                  <TD>
                    <ActionButton action={closeTeamAction.bind(null, { teamId: t.id })} confirm={`Close ${t.name}? Its members are removed from it and ${t.managerName} stops seeing their records.`} variant="outline">Close team</ActionButton>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <p className="px-4 py-3 text-sm text-muted-foreground">No teams yet.</p>
        )}
      </Section>
    </>
  );
}
