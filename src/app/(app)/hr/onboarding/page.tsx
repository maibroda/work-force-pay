import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { onboardingTracker } from "@/server/services/hr-overview";
import { fmtDate } from "@/lib/dates";
import { fullName } from "@/lib/utils";
import { PageHeader, Section, Empty } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { Badge } from "@/components/ui/badge";
import { completeOnboardingTaskAction } from "@/app/actions/hr";
import { waiveTaskAction } from "@/app/actions/hr-lifecycle";

export default async function OnboardingTrackerPage() {
  const ctx = await requirePage("hr.view");
  const rows = await onboardingTracker(ctx);
  const manage = can(ctx.role, "hr.manage");
  const today = new Date();
  return (
    <>
      <PageHeader
        title="Onboarding tracker"
        description="Everyone whose onboarding checklist still has open steps, most overdue first. The checklist itself is edited under Settings → Onboarding & Exit Checklists."
      />
      {rows.map((r) => (
        <Section
          key={r.employee.id}
          title={`${r.employee.employeeNumber} — ${fullName(r.employee)}`}
          description={
            <span className="flex flex-wrap items-center gap-2">
              {r.employee.category.name} · joined {fmtDate(r.employee.employmentDate)} ·{" "}
              {r.totalCount - r.pendingCount}/{r.totalCount} done
              {r.overdueCount > 0 && <Badge tone="red">{r.overdueCount} overdue</Badge>}
            </span>
          }
          actions={
            <Link className="text-xs text-primary underline" href={`/employees/${r.employee.id}?tab=lifecycle`}>
              Open employee
            </Link>
          }
        >
          <ul className="divide-y text-sm">
            {r.tasks.map((t) => {
              const overdue = t.dueDate && t.dueDate < today;
              return (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div>
                    <span>{t.taskName}</span>
                    {!t.mandatory && <span className="ml-2 text-[11px] text-muted-foreground">(optional)</span>}
                    <div className="text-[11px] text-muted-foreground">
                      {t.responsibleRole ?? "—"} · due{" "}
                      <span className={overdue ? "font-medium text-red-700" : ""}>{t.dueDate ? fmtDate(t.dueDate) : "no date"}</span>
                    </div>
                  </div>
                  {manage && (
                    <div className="flex gap-1">
                      <ActionButton action={completeOnboardingTaskAction.bind(null, t.id)} variant="success">
                        Mark complete
                      </ActionButton>
                      <ActionButton action={waiveTaskAction.bind(null, "onboarding", t.id)} reason reasonPlaceholder="Why doesn't it apply?" variant="outline">
                        Not applicable
                      </ActionButton>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </Section>
      ))}
      {!rows.length && (
        <Section title="All clear">
          <Empty>Every joiner&apos;s onboarding checklist is complete.</Empty>
        </Section>
      )}
    </>
  );
}
