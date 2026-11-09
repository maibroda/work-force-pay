import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { PIP_STATUSES, PIP_STATUS_LABELS, type PipStatus } from "@/lib/pip";
import { eligibleOwners, listPlans, planAttention } from "@/server/services/pip";
import { getHrPolicy, todayUtc } from "@/server/services/hr-policy";
import { fmtDate } from "@/lib/dates";
import { fullName } from "@/lib/utils";
import { Empty, FilterBar, FilterField, FormPanel, PageHeader, Section, Stat, StatGrid } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { createPlanAction } from "@/app/actions/pip";

const TONE: Record<PipStatus, "gray" | "amber" | "blue" | "green" | "red"> = { DRAFT: "gray", AWAITING_APPROVAL: "amber", ACTIVE: "blue", OUTCOME_PROPOSED: "amber", CLOSED: "green", WITHDRAWN: "gray" };

export default async function ImprovementPlansPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePage("pip.view");
  const sp = await searchParams;
  const status = (PIP_STATUSES as readonly string[]).includes(sp.status ?? "") ? (sp.status as PipStatus) : undefined;
  const canManage = can(ctx.role, "pip.manage");
  const [plans, attention, owners, policy] = await Promise.all([listPlans(ctx, { status }), planAttention(ctx.orgId, todayUtc()), canManage ? eligibleOwners(ctx) : Promise.resolve([]), getHrPolicy(ctx.orgId)]);
  const open = plans.filter((p) => ["DRAFT", "AWAITING_APPROVAL", "ACTIVE", "OUTCOME_PROPOSED"].includes(p.status)).length;
  return (
    <>
      <PageHeader
        title="Improvement plans"
        description="A structured plan to bring one employee's performance up to the standard: concerns, objectives with support, reviews, and an outcome. It is about capability, not conduct, so it is not a sanction and changes no pay or status. A second person starts each plan and approves its outcome. Plans are personal: only people with access to them see this page."
      />
      <StatGrid cols={4}>
        <Stat label="Open plans" value={open} />
        <Stat label="Waiting for approval" value={attention.awaitingApproval.length + attention.outcomeAwaiting.length} tone={attention.awaitingApproval.length + attention.outcomeAwaiting.length ? "amber" : undefined} />
        <Stat label="Reviews overdue" value={attention.reviewOverdue.length} tone={attention.reviewOverdue.length ? "red" : undefined} />
        <Stat label="Past their end date" value={attention.pastEnd.length} tone={attention.pastEnd.length ? "amber" : undefined} />
      </StatGrid>

      {canManage && (
        <FormPanel title="Draft a plan">
          <SmartForm
            columns={3}
            submitLabel="Save draft"
            action={createPlanAction}
            fields={[
              { name: "employeeNumber", label: "Employee number", required: true, placeholder: "e.g. EMP-000012" },
              { name: "startDate", label: "Start date", type: "date", required: true },
              { name: "days", label: `Length in days (default ${policy.pipDefaultDays}, longest ${policy.pipMaxDays})`, type: "number", min: 1, max: policy.pipMaxDays },
              { name: "ownerUserId", label: "Plan owner (reviews progress)", type: "select", required: true, options: owners.map((u) => ({ value: u.id, label: u.name })) },
              { name: "concerns", label: "The concerns: what is not meeting the standard, in plain words", type: "textarea", required: true, span: 3 },
            ]}
          />
          <p className="mt-2 text-xs text-muted-foreground">To start a plan from an appraisal that recommended one, open that appraisal.</p>
        </FormPanel>
      )}

      <FilterBar action="/hr/improvement-plans">
        <FilterField label="Status">
          <Select name="status" defaultValue={status ?? ""}>
            <option value="">All</option>
            {PIP_STATUSES.map((s) => (
              <option key={s} value={s}>
                {PIP_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </FilterField>
      </FilterBar>

      <Section title={`${plans.length} plan${plans.length === 1 ? "" : "s"}`} flush>
        {plans.length === 0 ? (
          <Empty>No plans.</Empty>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Employee</TH>
                <TH>Status</TH>
                <TH>Dates</TH>
                <TH>Owner</TH>
                <TH>Next review</TH>
                <TH>Objectives / reviews</TH>
              </TR>
            </THead>
            <TBody>
              {plans.map((p) => (
                <TR key={p.id}>
                  <TD>
                    <Link className="font-medium text-primary hover:underline" href={`/hr/improvement-plans/${p.id}`}>
                      {fullName(p.employee)}
                    </Link>
                    <div className="text-xs text-muted-foreground">{p.employee.employeeNumber}</div>
                  </TD>
                  <TD>
                    <Badge tone={TONE[p.status as PipStatus]}>{PIP_STATUS_LABELS[p.status as PipStatus]}</Badge>
                  </TD>
                  <TD className="text-xs">
                    {fmtDate(p.startDate)} – {fmtDate(p.endDate)}
                  </TD>
                  <TD className="text-xs">{p.ownerName}</TD>
                  <TD className="text-xs">
                    {p.reviewState === "OVERDUE" ? <Badge tone="red">overdue {fmtDate(p.nextReviewDue)}</Badge> : p.reviewState === "DUE" ? <Badge tone="amber">due today</Badge> : p.nextReviewDue && p.status === "ACTIVE" ? fmtDate(p.nextReviewDue) : "—"}
                  </TD>
                  <TD className="text-xs">
                    {p._count.objectives} / {p._count.reviews}
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
