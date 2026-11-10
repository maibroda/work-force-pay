import { requirePage } from "@/lib/auth/session";
import { SKILL_LEVELS, SKILL_LEVEL_DESCRIPTIONS, SKILL_LEVEL_LABELS } from "@/lib/skills";
import { listRoleSkills, listSkills } from "@/server/services/skills";
import { listRoles } from "@/server/services/career";
import { Empty, FormPanel, PageHeader, Section } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { SmartForm } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { addSkillAction, removeRoleSkillAction, setRoleSkillAction, setSkillActiveAction } from "@/app/actions/skills";

export default async function SkillsSettingsPage() {
  const ctx = await requirePage("hr.configure");
  const [skills, requirements, roles] = await Promise.all([listSkills(ctx), listRoleSkills(ctx), listRoles(ctx)]);
  const levelOptions = SKILL_LEVELS.map((l) => ({ value: String(l), label: `${l}: ${SKILL_LEVEL_LABELS[l]} (${SKILL_LEVEL_DESCRIPTIONS[l]})` }));
  return (
    <>
      <PageHeader
        title="Skills"
        description="The skills the company cares about, and the level of each that a role needs. A manager then assesses the people who report to them, and the gaps are shown to the person, their manager and HR. An assessment is a record, never edited (a correction is a new assessment), and it changes no pay, status, appraisal or promotion. The company starts with no skills."
      />
      <FormPanel title="Add a skill">
        <SmartForm
          columns={2}
          submitLabel="Add the skill"
          action={addSkillAction}
          fields={[
            { name: "name", label: "Skill", required: true, placeholder: "e.g. Shift supervision" },
            { name: "description", label: "What it means (optional)" },
            { name: "courses", label: "Courses that build it (optional: one per line, the names used in Training)", type: "textarea", span: 2 },
          ]}
        />
      </FormPanel>
      <Section title={`${skills.length} skill${skills.length === 1 ? "" : "s"}`} flush>
        {skills.length === 0 ? (
          <Empty>No skills yet.</Empty>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Skill</TH>
                <TH>Courses that build it</TH>
                <TH>Status</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {skills.map((s) => (
                <TR key={s.id} className={s.active ? "" : "opacity-60"}>
                  <TD>
                    {s.name}
                    {s.description && <div className="text-xs text-muted-foreground">{s.description}</div>}
                  </TD>
                  <TD className="whitespace-normal text-xs">{s.courses.length ? s.courses.join(", ") : "—"}</TD>
                  <TD>{s.active ? <Badge tone="green">On</Badge> : <Badge tone="gray">Off</Badge>}</TD>
                  <TD>
                    <ActionButton action={setSkillActiveAction.bind(null, s.id, !s.active)} variant="outline">
                      {s.active ? "Switch off" : "Switch on"}
                    </ActionButton>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Section>
      <FormPanel title="Set what a role needs">
        <SmartForm
          columns={3}
          submitLabel="Save the requirement"
          action={setRoleSkillAction}
          fields={[
            { name: "categoryId", label: "Role", type: "select", required: true, options: roles.map((r) => ({ value: r.id, label: r.name })) },
            { name: "skillId", label: "Skill", type: "select", required: true, options: skills.filter((s) => s.active).map((s) => ({ value: s.id, label: s.name })) },
            { name: "requiredLevel", label: "Level needed", type: "select", required: true, options: levelOptions },
          ]}
        />
      </FormPanel>
      <Section title={`${requirements.length} requirement${requirements.length === 1 ? "" : "s"}`} flush>
        {requirements.length === 0 ? (
          <Empty>No role needs a skill yet.</Empty>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Role</TH>
                <TH>Skill</TH>
                <TH>Level needed</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {requirements.map((r) => (
                <TR key={`${r.categoryId}-${r.skillId}`}>
                  <TD>{r.role}</TD>
                  <TD>{r.skillName}</TD>
                  <TD>
                    {r.requiredLevel}: {SKILL_LEVEL_LABELS[r.requiredLevel as 1 | 2 | 3 | 4]}
                  </TD>
                  <TD>
                    <ActionButton action={removeRoleSkillAction.bind(null, r.categoryId, r.skillId)} confirm="Remove this requirement? Assessments already made are kept." variant="outline">
                      Remove
                    </ActionButton>
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
