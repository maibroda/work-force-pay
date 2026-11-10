import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { SKILL_LEVEL_LABELS } from "@/lib/skills";
import { employeeSkills, learningPathFor, listSkills, roleGaps, staleAssessments } from "@/server/services/skills";
import { db } from "@/server/services/_base";
import { fmtDate } from "@/lib/dates";
import { fullName } from "@/lib/utils";
import { Empty, FilterBar, FilterField, PageHeader, Section } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { SkillRows } from "@/components/skill-rows";
import { Input } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { addNeedFromGapAction } from "@/app/actions/skills";

export default async function SkillsAndGapsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePage("hr.view");
  const sp = await searchParams;
  const [gaps, stale, skills] = await Promise.all([roleGaps(ctx), staleAssessments(ctx), listSkills(ctx)]);
  const number = sp.employee?.trim();
  const looked = number ? await db.employee.findFirst({ where: { organizationId: ctx.orgId, employeeNumber: { equals: number, mode: "insensitive" } }, select: { id: true } }) : null;
  const person = looked ? await employeeSkills(ctx, looked.id) : null;
  const paths = looked ? await learningPathFor(ctx, looked.id) : [];
  const canAct = can(ctx.role, "hr.manage");
  const coursesOf = (skillId: string) => skills.find((s) => s.id === skillId)?.courses ?? [];
  return (
    <>
      <PageHeader
        title="Skills and gaps"
        description="Where people stand against the skills their role needs. Not assessed is counted apart from a gap: a missing assessment is never read as a weakness. A gap changes nothing by itself: HR can add a training need for it, and nothing else follows until someone plans it. The employee reads everything recorded about them."
      />
      <FilterBar action="/hr/skills">
        <FilterField label="Look at one person (employee number)">
          <Input name="employee" defaultValue={sp.employee ?? ""} placeholder="e.g. EMP-000012" />
        </FilterField>
      </FilterBar>
      {number && (
        <Section title={person ? `${fullName(person.employee)} (${person.employee.employeeNumber}), ${person.role}` : "Person"} description="Their current level of each skill their role needs, and the history." flush>
          {!person ? (
            <Empty>Employee not found.</Empty>
          ) : (
            <>
              <SkillRows
                rows={person.rows}
                extra={
                  canAct
                    ? (r) =>
                        r.status === "BELOW" ? (
                          <span className="flex flex-wrap gap-1">
                            {coursesOf(r.skillId).length === 0 && <span className="text-xs text-muted-foreground">No course linked</span>}
                            {coursesOf(r.skillId).map((c) => (
                              <ActionButton key={c} action={addNeedFromGapAction.bind(null, person.employee.id, r.skillId, c)} confirm={`Add "${c}" to the training needs list for this person?`} variant="outline">
                                Add need: {c}
                              </ActionButton>
                            ))}
                          </span>
                        ) : null
                    : undefined
                }
              />
              {paths.length > 0 && (
                <div className="space-y-2 p-3 text-sm">
                  {paths.map((p) => (
                    <div key={p.toRole}>
                      <b>Towards {p.toRole}:</b>{" "}
                      {p.skills.length === 0 ? "every skill the role needs is met." : p.skills.map((s) => `${s.name} (${s.status === "NOT_ASSESSED" ? "not assessed" : `at ${s.current}, needs ${s.requiredLevel}`})`).join("; ")}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </Section>
      )}
      <Section title="By role and skill" description="How many people are at or above the level the role needs, below it, and not yet assessed." flush>
        {gaps.length === 0 ? (
          <Empty>No role needs a skill yet. Set them under Settings → Skills.</Empty>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Role</TH>
                <TH>Skill</TH>
                <TH>Needed</TH>
                <TH>At or above</TH>
                <TH>Below</TH>
                <TH>Not assessed</TH>
              </TR>
            </THead>
            <TBody>
              {gaps.flatMap((g) =>
                g.skills.map((s) => (
                  <TR key={`${g.categoryId}-${s.skillId}`}>
                    <TD>{g.role}</TD>
                    <TD>{s.name}</TD>
                    <TD className="text-xs">
                      {s.requiredLevel}: {SKILL_LEVEL_LABELS[s.requiredLevel as 1 | 2 | 3 | 4]}
                    </TD>
                    <TD>{s.met}</TD>
                    <TD className="whitespace-normal">
                      {s.below}
                      {s.belowPeople.length > 0 && <div className="text-xs text-muted-foreground">{s.belowPeople.map((p) => `${fullName(p)} (${p.current})`).join(", ")}</div>}
                    </TD>
                    <TD>{s.notAssessed}</TD>
                  </TR>
                )),
              )}
            </TBody>
          </Table>
        )}
      </Section>
      <Section title="Assessments to refresh" description="The current assessments older than the number of days set in HR policy. A prompt only: never a score and never a block." flush>
        {stale.length === 0 ? (
          <Empty>Nothing is stale.</Empty>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Employee</TH>
                <TH>Skill</TH>
                <TH>Level</TH>
                <TH>Assessed</TH>
              </TR>
            </THead>
            <TBody>
              {stale.map((s, i) => (
                <TR key={i}>
                  <TD>
                    {fullName(s.employee)}
                    <div className="text-xs text-muted-foreground">{s.employee.employeeNumber}</div>
                  </TD>
                  <TD>{s.skillName}</TD>
                  <TD>{s.level}</TD>
                  <TD className="text-xs">{fmtDate(s.assessedOn)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Section>
    </>
  );
}
