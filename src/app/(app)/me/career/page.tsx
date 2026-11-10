import { requirePage } from "@/lib/auth/session";
import { myCareer } from "@/server/services/career";
import { fmtDate } from "@/lib/dates";
import { Empty, PageHeader, Section } from "@/components/page";
import { Badge } from "@/components/ui/badge";

export default async function MyCareerPage() {
  const ctx = await requirePage();
  const c = await myCareer(ctx);
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
        </>
      )}
    </>
  );
}
