import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { TRAINING_REQUEST_STATUSES, TRAINING_REQUEST_STATUS_LABELS, type TrainingRequestStatus } from "@/lib/training-evaluation";
import { listRequests } from "@/server/services/training-evaluation";
import { FilterBar, FilterField, FormPanel, PageHeader, Section } from "@/components/page";
import { RequestList } from "@/components/training-request-list";
import { SmartForm } from "@/components/smart-form";
import { Select } from "@/components/ui/input";
import { requestTrainingAction } from "@/app/actions/training-evaluation";

export default async function TrainingRequestsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePage("hr.view");
  const sp = await searchParams;
  const status = (TRAINING_REQUEST_STATUSES as readonly string[]).includes(sp.status ?? "") ? (sp.status as TrainingRequestStatus) : undefined;
  const rows = await listRequests(ctx, { status });
  return (
    <>
      <PageHeader
        title="Training requests"
        description="A manager can ask for a course for one of their direct reports, and HR for anyone. Someone other than the person who asked decides. Accepting only adds the course to the training needs list: it enrols no one, books no seat and creates no certificate. The employee is not told of a request, and never of one that is declined or still being considered."
      />
      {can(ctx.role, "training.request") && (
        <FormPanel title="Request a course">
          <SmartForm
            columns={3}
            submitLabel="Send the request"
            action={requestTrainingAction}
            fields={[
              { name: "employeeNumber", label: "Employee number", required: true, placeholder: "e.g. EMP-000012" },
              { name: "courseName", label: "Course", required: true, placeholder: "e.g. First aid" },
              { name: "reason", label: "Why, in a few plain sentences", type: "textarea", required: true, span: 3 },
            ]}
          />
        </FormPanel>
      )}
      <FilterBar action="/hr/training-requests">
        <FilterField label="Status">
          <Select name="status" defaultValue={status ?? ""}>
            <option value="">All</option>
            {TRAINING_REQUEST_STATUSES.map((s) => (
              <option key={s} value={s}>
                {TRAINING_REQUEST_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </FilterField>
      </FilterBar>
      <Section title={`${rows.length} request${rows.length === 1 ? "" : "s"}`} flush>
        <RequestList rows={rows as never} canDecide={can(ctx.role, "hr.manage")} userId={ctx.userId} />
      </Section>
    </>
  );
}
