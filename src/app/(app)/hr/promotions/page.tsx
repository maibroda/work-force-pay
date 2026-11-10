import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { PROMOTION_STATUSES, PROMOTION_STATUS_LABELS, PROMOTION_WARNING_LABELS, type PromotionStatus } from "@/lib/career";
import { listPromotions, listRoles, promotionEvidence } from "@/server/services/career";
import { db } from "@/server/services/_base";
import { Empty, FilterBar, FilterField, FormPanel, KV, PageHeader, Section } from "@/components/page";
import { PromotionList } from "@/components/promotion-list";
import { SmartForm } from "@/components/smart-form";
import { Input, Select } from "@/components/ui/input";
import { proposePromotionAction } from "@/app/actions/career";

export default async function PromotionsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePage("hr.view");
  const sp = await searchParams;
  const status = (PROMOTION_STATUSES as readonly string[]).includes(sp.status ?? "") ? (sp.status as PromotionStatus) : undefined;
  const [rows, roles] = await Promise.all([listPromotions(ctx, { status }), listRoles(ctx)]);
  // a lookup of the evidence for one employee, read-only
  const number = sp.employee?.trim();
  const looked = number ? await db.employee.findFirst({ where: { organizationId: ctx.orgId, employeeNumber: { equals: number, mode: "insensitive" } }, select: { id: true, employeeNumber: true, firstName: true, lastName: true } }) : null;
  const ev = looked ? await promotionEvidence(ctx, looked.id) : null;
  return (
    <>
      <PageHeader
        title="Promotions"
        description="A proposal that an employee moves to another role. It is a record of a decision, not a change: approving it alters no role, pay or payroll figure. Someone other than the proposer decides, then HR changes the role on the employee's record, proposes the new pay through the usual pay-rate proposal, and marks the promotion applied. The employee is told only of an approved promotion, never of a proposal being considered or one that was declined."
      />
      {can(ctx.role, "career.propose") && (
        <FormPanel title="Propose a promotion">
          <SmartForm
            columns={3}
            submitLabel="Send the proposal"
            action={proposePromotionAction}
            fields={[
              { name: "employeeNumber", label: "Employee number", required: true, placeholder: "e.g. EMP-000012" },
              { name: "toCategoryId", label: "Moves to the role", type: "select", required: true, options: roles.map((r) => ({ value: r.id, label: r.name })) },
              { name: "intendedOn", label: "Intended from", type: "date", required: true },
              { name: "reason", label: "Why, in a few plain sentences", type: "textarea", required: true, span: 3 },
            ]}
          />
        </FormPanel>
      )}
      <FilterBar action="/hr/promotions">
        <FilterField label="Status">
          <Select name="status" defaultValue={status ?? ""}>
            <option value="">All</option>
            {PROMOTION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {PROMOTION_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </FilterField>
        <FilterField label="Evidence for employee number">
          <Input name="employee" defaultValue={sp.employee ?? ""} placeholder="e.g. EMP-000012" />
        </FilterField>
      </FilterBar>
      {number && (
        <Section title={looked ? `Evidence: ${looked.firstName} ${looked.lastName} (${looked.employeeNumber})` : "Evidence"} description="Read-only, to help whoever decides. Nothing here changes by itself.">
          {!looked || !ev ? (
            <Empty>Employee not found.</Empty>
          ) : (
            <>
              <KV
                cols={3}
                items={[
                  ["Time in the current role", `${ev.monthsInRole} months`],
                  ["Latest signed-off appraisal", ev.latestAppraisal ? `${ev.latestAppraisal.score ?? "no score"}${ev.latestAppraisal.band ? ` (${ev.latestAppraisal.band})` : ""}, recommended: ${ev.latestAppraisal.recommendation.replace(/_/g, " ").toLowerCase()}` : "None yet"],
                  ["Improvement plan open", ev.openPlan ? "Yes" : "No"],
                  ["Disciplinary case open", ev.openDiscipline ? "Yes" : "No"],
                  ["Career paths from this role", ev.paths.length ? ev.paths.map((p) => `${p.toRole}${p.minMonths !== null ? ` (${p.minMonths} months)` : ""}${p.requiredCourse ? ` + ${p.requiredCourse}` : ""}`).join("; ") : "None set"],
                ]}
              />
              <p className="mt-2 text-xs text-muted-foreground">
                Warnings that can apply to a proposal: {Object.values(PROMOTION_WARNING_LABELS).join("; ")}. A warning never blocks a proposal; the decider gives a reason to approve.
              </p>
            </>
          )}
        </Section>
      )}
      <Section title={`${rows.length} proposal${rows.length === 1 ? "" : "s"}`} flush>
        <PromotionList rows={rows as never} canDecide={can(ctx.role, "hr.approve")} canApply={can(ctx.role, "hr.manage")} userId={ctx.userId} />
      </Section>
    </>
  );
}
