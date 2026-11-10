import { requirePage } from "@/lib/auth/session";
import { mySkills } from "@/server/services/skills";
import { PageHeader, Section } from "@/components/page";
import { SkillRows } from "@/components/skill-rows";

export default async function MySkillsPage() {
  const ctx = await requirePage();
  const s = await mySkills(ctx);
  return (
    <>
      <PageHeader
        title="My skills"
        description="The skills your role needs, the level the company asks for and where you stand now, with every assessment recorded about you, who made it and when. Nothing about you is kept that you cannot read here. An assessment is one person's judgement on one day: it changes nothing about your pay, your status or your appraisal."
      />
      {!ctx.employeeId || !s.role ? (
        <Section title="Not available">
          <p className="text-sm text-muted-foreground">Your login isn&apos;t linked to an employee record yet — ask HR to link it.</p>
        </Section>
      ) : (
        <Section title={s.role} flush>
          <SkillRows rows={s.rows} />
        </Section>
      )}
    </>
  );
}
