import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { canCtx } from "@/lib/hr-functions";
import { listSurveys } from "@/server/services/survey";
import { db } from "@/lib/db";
import { fmtDate } from "@/lib/dates";
import { Empty, FormPanel, PageHeader, Section } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { SmartForm } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { createSurveyAction, runSurveyRetentionAction } from "@/app/actions/survey";

const TONE: Record<string, "amber" | "green" | "red" | "gray" | "blue"> = { DRAFT: "gray", SCHEDULED: "blue", OPEN: "green", CLOSED: "amber" };
const LABEL: Record<string, string> = { DRAFT: "Draft", SCHEDULED: "Opens later", OPEN: "Open", CLOSED: "Closed" };

export default async function SurveysPage() {
  // HR viewers, and a Delegated HR Officer holding the Surveys function (who has no general HR permission)
  const ctx = await requirePage("hr.view", { orPermission: "survey.manage" });
  // only roles and departments: this page is open to a Delegated HR Officer holding the Surveys function, who must not be handed the list of employees
  const [rows, categories, departments] = await Promise.all([listSurveys(ctx), db.employeeCategory.findMany({ where: { organizationId: ctx.orgId }, select: { id: true, name: true }, orderBy: { name: "asc" } }), db.department.findMany({ where: { organizationId: ctx.orgId }, select: { id: true, name: true }, orderBy: { name: "asc" } })]);
  const opts = { categories: categories.map((c) => ({ value: c.id, label: c.name })), departments: departments.map((c) => ({ value: c.id, label: c.name })) };
  const canManage = canCtx(ctx, "survey.manage");
  return (
    <>
      <PageHeader
        title="Surveys"
        description="Ask the workforce, or one role or department, how they feel. Answers are anonymous by design: an answer carries no person and no time, nobody can list who took part (HR sees counts only), and nothing is shown below five answers. A group is shown on its own only with at least ten invited and five answers. Employees with a login answer in My surveys; others answer with a personal access code on their own phone, a shared device or an assisted session. A survey changes nothing about any person."
      />
      {canManage && (
        <FormPanel title="Create a survey">
          <SmartForm
            columns={3}
            submitLabel="Create the survey"
            action={createSurveyAction}
            fields={[
              { name: "title", label: "Title", required: true, placeholder: "e.g. Working here, November" },
              { name: "opensOn", label: "Opens on", type: "date", required: true },
              { name: "closesOn", label: "Closes on", type: "date", required: true },
              { name: "categoryId", label: "Invite one role only (optional)", type: "select", options: opts.categories },
              { name: "departmentId", label: "Or one department only (optional)", type: "select", options: opts.departments },
              { name: "intro", label: "A short introduction employees will read (optional)", type: "textarea", span: 3 },
            ]}
          />
        </FormPanel>
      )}
      <Section title={`${rows.length} survey${rows.length === 1 ? "" : "s"}`} flush>
        {rows.length === 0 ? (
          <Empty>No survey yet.</Empty>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Survey</TH>
                <TH>Status</TH>
                <TH>Open</TH>
                <TH>Took part</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id}>
                  <TD>
                    <Link className="text-primary underline" href={`/hr/surveys/${r.id}`}>
                      {r.title}
                    </Link>
                  </TD>
                  <TD>
                    <Badge tone={TONE[r.state]}>{LABEL[r.state]}</Badge>
                    {r.rawDeleted && <div className="mt-1 text-xs text-muted-foreground">Raw answers deleted; results kept</div>}
                  </TD>
                  <TD className="text-xs">
                    {fmtDate(r.opensOn)} to {fmtDate(r.closesOn)}
                  </TD>
                  <TD>{r.state === "DRAFT" ? "—" : `${r.took} of ${r.invited}`}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Section>
      {canManage && (
        <Section title="Keeping answers for a limited time" description="Raw answers and codes are deleted a set number of months after a survey closes (Settings, HR policy; default 24). The anonymised results are kept.">
          <ActionButton action={runSurveyRetentionAction} confirm="Delete the raw answers of every survey past its retention period? The anonymised results are kept." variant="outline">
            Delete answers past their retention period now
          </ActionButton>
        </Section>
      )}
    </>
  );
}
