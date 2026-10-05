import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { listRequisitions } from "@/server/services/recruitment";
import { options, enumOptions } from "@/server/options";
import { fmtDate } from "@/lib/dates";
import { naira } from "@/lib/money";
import { FilterBar, FilterField, FormPanel, PageHeader, Section, Empty } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { Select } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { createRequisitionAction } from "@/app/actions/hr-lifecycle";

const STATUSES = ["PENDING_APPROVAL", "APPROVED", "ON_HOLD", "FILLED", "REJECTED", "CLOSED"];
const TYPES = ["PERMANENT", "FIXED_TERM", "PROBATION", "CASUAL", "CONSULTANT", "INTERNSHIP"];

export default async function RequisitionsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePage("hr.view");
  const sp = await searchParams;
  const [rows, o] = await Promise.all([listRequisitions(ctx, { status: sp.status }), options(ctx)]);
  return (
    <>
      <PageHeader
        title="Job requisitions"
        description="A role is requested, then approved by someone other than the requester, before any candidate can be added. Hires fill the headcount and close the requisition automatically."
      />
      <FilterBar>
        <FilterField label="Status">
          <Select name="status" defaultValue={sp.status ?? ""}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ")}
              </option>
            ))}
          </Select>
        </FilterField>
      </FilterBar>

      {can(ctx.role, "hr.manage") && (
        <FormPanel title="Raise a requisition">
          <SmartForm
            columns={3}
            submitLabel="Raise requisition"
            action={createRequisitionAction}
            fields={[
              { name: "title", label: "Job title", required: true, span: 2 },
              { name: "categoryId", label: "Employee category", type: "select", required: true, options: o.categories },
              { name: "departmentId", label: "Department", type: "select", options: o.departments },
              { name: "costCenterId", label: "Cost center", type: "select", options: o.costCenters },
              { name: "beatId", label: "Beat / location being staffed", type: "select", options: o.beats },
              { name: "hiringManagerId", label: "Hiring manager (reports to)", type: "select", options: o.employees },
              { name: "headcount", label: "Positions", type: "number", min: 1, defaultValue: 1, required: true },
              { name: "employmentType", label: "Employment type", type: "select", options: enumOptions(TYPES), defaultValue: "PERMANENT" },
              { name: "budgetedMonthlyGross", label: "Budgeted monthly gross (₦)", type: "number", min: 1 },
              { name: "targetStartDate", label: "Target start date", type: "date" },
              { name: "justification", label: "Why is this role needed?", type: "textarea", required: true, span: 3 },
            ]}
          />
        </FormPanel>
      )}

      <Section title={`${rows.length} requisition(s)`} flush>
        <Table>
          <THead>
            <TR>
              <TH>Requisition</TH>
              <TH>Role</TH>
              <TH>Category / department</TH>
              <TH className="text-right">Positions</TH>
              <TH className="text-right">In pipeline</TH>
              <TH className="text-right">Hired</TH>
              <TH>Budget</TH>
              <TH>Raised</TH>
              <TH>Status</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.id}>
                <TD className="font-mono text-xs">
                  <Link className="text-primary underline" href={`/hr/requisitions/${r.id}`}>
                    {r.requisitionNumber}
                  </Link>
                </TD>
                <TD>{r.title}</TD>
                <TD className="text-xs">
                  {r.category.name}
                  {r.department ? ` · ${r.department.name}` : ""}
                </TD>
                <TD className="text-right">{r.headcount}</TD>
                <TD className="text-right">{r.inPipeline}</TD>
                <TD className="text-right">{r.hired}</TD>
                <TD>{r.budgetedMonthlyGross ? naira(r.budgetedMonthlyGross) : "—"}</TD>
                <TD className="text-xs">
                  {fmtDate(r.createdAt)} · {r.requestedBy}
                </TD>
                <TD>
                  <StatusBadge status={r.status} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!rows.length && <Empty>No requisitions yet — raise one above.</Empty>}
      </Section>
    </>
  );
}
