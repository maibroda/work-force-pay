import { requirePage } from "@/lib/auth/session";
import { SKILL_LEVELS, SKILL_LEVEL_DESCRIPTIONS, SKILL_LEVEL_LABELS } from "@/lib/skills";
import { employeeSkills, listSkills } from "@/server/services/skills";
import { db } from "@/server/services/_base";
import { fullName } from "@/lib/utils";
import { Empty, FilterBar, FilterField, FormPanel, PageHeader, Section } from "@/components/page";
import { SkillRows } from "@/components/skill-rows";
import { SmartForm } from "@/components/smart-form";
import { Input } from "@/components/ui/input";
import { assessSkillAction } from "@/app/actions/skills";

export default async function TeamSkillsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePage("skills.assess");
  const sp = await searchParams;
  const skills = (await listSkills(ctx)).filter((s) => s.active);
  const number = sp.employee?.trim();
  const looked = number ? await db.employee.findFirst({ where: { organizationId: ctx.orgId, employeeNumber: { equals: number, mode: "insensitive" } }, select: { id: true } }) : null;
  // for anyone who is not this person's manager the answer is only "not found"
  const person = looked ? await employeeSkills(ctx, looked.id).catch(() => null) : null;
  return (
    <>
      <PageHeader
        title="My team's skills"
        description="Assess the skills of the people who report to you. Each assessment is a record: a correction is a new assessment and the earlier ones stay as history. The employee reads everything you record, so keep it factual. It changes nothing about their pay, status or appraisal."
      />
      {!ctx.employeeId ? (
        <Section title="Not available">
          <p className="text-sm text-muted-foreground">Your login isn&apos;t linked to an employee record yet, so you have no direct reports here — ask HR to link it.</p>
        </Section>
      ) : (
        <>
          <FormPanel title="Assess a skill">
            {skills.length === 0 ? (
              <Empty>HR has not set up any skill yet.</Empty>
            ) : (
              <SmartForm
                columns={3}
                submitLabel="Record the assessment"
                action={assessSkillAction}
                fields={[
                  { name: "employeeNumber", label: "Employee number", required: true, placeholder: "e.g. EMP-000012" },
                  { name: "skillId", label: "Skill", type: "select", required: true, options: skills.map((s) => ({ value: s.id, label: s.name })) },
                  { name: "level", label: "Level", type: "select", required: true, options: SKILL_LEVELS.map((l) => ({ value: String(l), label: `${l}: ${SKILL_LEVEL_LABELS[l]} (${SKILL_LEVEL_DESCRIPTIONS[l]})` })) },
                  { name: "comment", label: "A line about it (optional, up to 300 characters)", span: 3 },
                ]}
              />
            )}
          </FormPanel>
          <FilterBar action="/me/team-skills">
            <FilterField label="See one person's skills (employee number)">
              <Input name="employee" defaultValue={sp.employee ?? ""} placeholder="e.g. EMP-000012" />
            </FilterField>
          </FilterBar>
          {number && (
            <Section title={person ? `${fullName(person.employee)} (${person.employee.employeeNumber}), ${person.role}` : "Person"} flush>
              {!person ? <Empty>Employee not found.</Empty> : <SkillRows rows={person.rows} />}
            </Section>
          )}
        </>
      )}
    </>
  );
}
