import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { listDeployments } from "@/server/services/operations";
import { enumOptions, options } from "@/server/options";
import { fmtDate } from "@/lib/dates";
import { fullName } from "@/lib/utils";
import { FilterBar, FilterField, FormPanel, PageHeader, Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { StatusBadge } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { deployAction } from "@/app/actions/operations";

export default async function DeploymentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requirePage("operations.view");
  const sp = await searchParams;
  const [rows, o] = await Promise.all([
    listDeployments(ctx, { beatId: sp.beatId, clientId: sp.clientId, activeOnly: sp.all !== "1", q: sp.q }),
    options(ctx),
  ]);
  return (
    <>
      <PageHeader
        title="Deployment & employee assignments"
        description="Operations maps employees to beats. Deploying ends the employee's previous assignment the day before; the employee number never changes."
      />
      {can(ctx.role, "operations.manage") && (
        <FormPanel title="Deploy employee to beat" open={Boolean(sp.beatId)}>
          <SmartForm
            columns={3}
            fields={[
              { name: "employeeId", label: "Employee", type: "select", required: true, options: o.employees },
              {
                name: "beatId",
                label: "Beat",
                type: "select",
                required: true,
                options: o.beats,
                defaultValue: sp.beatId,
              },
              { name: "startDate", label: "Start date", type: "date", required: true },
              {
                name: "categoryId",
                label: "Category at beat (optional)",
                type: "select",
                options: o.categories,
              },
              {
                name: "shift",
                label: "Shift",
                type: "select",
                options: enumOptions(["FULL", "DAY", "NIGHT"]),
                defaultValue: "FULL",
              },
            ]}
            action={deployAction}
            submitLabel="Deploy"
          />
        </FormPanel>
      )}
      <FilterBar>
        <FilterField label="Search employee">
          <Input name="q" defaultValue={sp.q} className="w-48" />
        </FilterField>
        <FilterField label="Client">
          <Select name="clientId" defaultValue={sp.clientId ?? ""}>
            <option value="">All</option>
            {o.clients.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </FilterField>
        <FilterField label="Beat">
          <Select name="beatId" defaultValue={sp.beatId ?? ""}>
            <option value="">All</option>
            {o.beats.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </FilterField>
        <label className="flex items-center gap-1 pb-2 text-xs">
          <input type="checkbox" name="all" value="1" defaultChecked={sp.all === "1"} /> Include ended
        </label>
      </FilterBar>
      <Section title={`${rows.length} assignment(s)`} flush>
        <Table>
          <THead>
            <TR>
              <TH>Employee</TH>
              <TH>Name</TH>
              <TH>Client</TH>
              <TH>Contract</TH>
              <TH>Beat</TH>
              <TH>Category</TH>
              <TH>Shift</TH>
              <TH>From</TH>
              <TH>To</TH>
              <TH>Status</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((x) => (
              <TR key={x.id}>
                <TD>
                  <Link
                    className="text-primary hover:underline"
                    href={`/employees/${x.employeeId}?tab=assignments`}
                  >
                    {x.employee.employeeNumber}
                  </Link>
                </TD>
                <TD>{fullName(x.employee)}</TD>
                <TD>{x.client.name}</TD>
                <TD className="font-mono text-xs">{x.contract.contractNumber}</TD>
                <TD>{x.beat.name}</TD>
                <TD>{x.category.name}</TD>
                <TD>{x.shift}</TD>
                <TD>{fmtDate(x.startDate)}</TD>
                <TD>{fmtDate(x.endDate)}</TD>
                <TD>
                  <StatusBadge status={x.status} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Section>
    </>
  );
}
