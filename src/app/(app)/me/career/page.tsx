import { requirePage } from "@/lib/auth/session";
import { myCareer } from "@/server/services/career";
import { myLearningPaths } from "@/server/services/skills";
import { fmtDate } from "@/lib/dates";
import { Empty, PageHeader, Section } from "@/components/page";
import { Badge } from "@/components/ui/badge";

export default async function MyCareerPage() {
  const ctx = await requirePage();
  const [c, learning] = await Promise.all([myCareer(ctx), myLearningPaths(ctx)]);
  return (
    <>
      <PageHeader title="My career" description="Your role now, the roles the company says it can lead to, and how you stand against what it asks. This is guidance, not a promise: a promotion is a decision made by people at the company." />
      {!ctx.employeeId || !c.role ? (
        <Section title="Not available">
          <p className="text-sm text-muted-foreground">Your login isn&apos;t linked to an employee record yet — ask HR to link it.</p>
        </Section>
      ) : (
        <>
          <Section title={c.role} description={`${c.monthsInRole} months in this role`}>
            {c.promotion ? (
              <p className="text-sm">
                {c.promotion.status === "APPLIED" ? (
                  <>
                    <Badge tone="green">Promoted</Badge> to {c.promotion.toRole}
                    {c.promotion.appliedAt ? `, applied ${fmtDate(c.promotion.appliedAt)}` : ""}.
                  </>
                ) : (
                  <>
                    <Badge tone="blue">Approved</Badge> for {c.promotion.toRole}, intended from {fmtDate(c.promotion.intendedOn)}.
                  </>
                )}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">No promotion has been decided for you.</p>
            )}
          </Section>
          <Section title="Where this role can lead">
            {c.paths.length === 0 ? (
              <Empty>The company has not set a path from your role yet.</Empty>
            ) : (
              <ul className="space-y-2 text-sm">
                {c.paths.map((p) => (
                  <li key={p.toRole}>
                    <b>{p.toRole}</b>
                    <div className="text-xs text-muted-foreground">
                      {p.minMonths !== null ? `Asks for ${p.minMonths} months in your current role: ${p.serviceMet ? "you have this" : "not yet"}. ` : "No time in role asked. "}
                      {p.requiredCourse ? `Asks for the course "${p.requiredCourse}": ${p.courseValid ? "you hold it" : "not on your record yet"}.` : "No course asked."}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          {learning.some((p) => p.skills.length > 0) && (
            <Section title="Skills to build" description="For each role your career path can lead to, the skills it needs where you are below the level, or not yet assessed, and the courses that build them. A guide, not a promise.">
              <ul className="space-y-3 text-sm">
                {learning
                  .filter((p) => p.skills.length > 0)
                  .map((p) => (
                    <li key={p.toRole}>
                      <b>To reach {p.toRole}</b>
                      <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                        {p.skills.map((s) => (
                          <li key={s.skillId}>
                            {s.name}: {s.status === "NOT_ASSESSED" ? "not assessed yet" : `you are at ${s.current}, the role needs ${s.requiredLevel}`}
                            {s.courses.length ? `. Courses that build it: ${s.courses.join(", ")}.` : "."}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
              </ul>
            </Section>
          )}
        </>
      )}
    </>
  );
}
