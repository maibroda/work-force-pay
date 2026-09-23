import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { listMovements } from "@/server/services/operations";
import { enumOptions, options } from "@/server/options";
import { fmtDate } from "@/lib/dates";
import { fullName } from "@/lib/utils";
import { FilterBar, FilterField, FormPanel, PageHeader, Section, Empty } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { ActionButton } from "@/components/action-button";
import { StatusBadge } from "@/components/ui/badge";
import { Select } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { approveMovementAction, createMovementAction, rejectMovementAction } from "@/app/actions/operations";

const TYPES = [
  "PERMANENT_TRANSFER",
  "TEMPORARY_TRANSFER",
  "RELIEF",
  "REPLACEMENT",
  "CLIENT_TRANSFER",
  "LOCATION_TRANSFER",
  "SHIFT_CHANGE",
];
const TITLES: Record<string, string> = {
  REPLACEMENT: "Replacements",
  PERMANENT_TRANSFER: "Transfers",
  RELIEF: "Reliefs",
};

export default async function MovementsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requirePage("operations.view");
  const sp = await searchParams;
  const [rows, o] = await Promise.all([
    listMovements(ctx, { status: sp.status, type: sp.type }),
    options(ctx),
  ]);
  const approver = can(ctx.role, "movement.approve");
  return (
    <>
      <PageHeader
        title={sp.type ? (TITLES[sp.type] ?? "Staff movement") : "Staff movement"}
        description="An employee can work at several beats in one payroll period. Approved movements create the deployments; temporary moves and reliefs return the employee to the original beat after the end date."
      />
      {can(ctx.role, "operations.manage") && (
        <FormPanel title="Record staff movement">
          <SmartForm
            columns={3}
            fields={[
              { name: "employeeId", label: "Employee", type: "select", required: true, options: o.employees },
              {
                name: "toBeatId",
                label: "New client / beat",
                type: "select",
                required: true,
                options: o.beats,
              },
              {
                name: "movementType",
                label: "Movement type",
                type: "select",
                required: true,
                options: enumOptions(TYPES),
                defaultValue: sp.type,
              },
              { name: "movementDate", label: "Movement date", type: "date", required: true },
              { name: "effectiveDate", label: "Effective date", type: "date", required: true },
              { name: "endDate", label: "End date (temporary / relief)", type: "date" },
              { name: "reason", label: "Reason", required: true, span: 2 },
              { name: "remarks", label: "Remarks" },
              { name: "approve", label: "Approve immediately", type: "checkbox", defaultValue: approver },
            ]}
            action={createMovementAction}
            submitLabel="Save movement"
          />
        </FormPanel>
      )}
      <FilterBar>
        <FilterField label="Type">
          <Select name="type" defaultValue={sp.type ?? ""}>
            <option value="">All</option>
            {TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>
        </FilterField>
        <FilterField label="Status">
          <Select name="status" defaultValue={sp.status ?? ""}>
            <option value="">All</option>
            {["PENDING", "APPROVED", "REJECTED"].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>
        </FilterField>
      </FilterBar>
      <Section title={`${rows.length} movement(s)`} flush>
        <Table>
          <THead>
            <TR>
              <TH>Employee</TH>
              <TH>Type</TH>
              <TH>Previous client / beat</TH>
              <TH>New client / beat</TH>
              <TH>Movement</TH>
              <TH>Effective</TH>
              <TH>Reason</TH>
              <TH>Requested / approved</TH>
              <TH>Status</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {rows.map((m) => (
              <TR key={m.id}>
                <TD>
                  <Link
                    className="text-primary hover:underline"
                    href={`/employees/${m.employeeId}?tab=assignments`}
                  >
                    {m.employee.employeeNumber}
                  </Link>
                  <div className="text-xs text-muted-foreground">{fullName(m.employee)}</div>
                </TD>
                <TD className="text-xs">{m.movementType.replace(/_/g, " ")}</TD>
                <TD className="text-xs">
                  {m.fromClient?.name ?? "—"}
                  <div>{m.fromBeat?.name}</div>
                </TD>
                <TD className="text-xs">
                  {m.toClient.name}
                  <div>{m.toBeat.name}</div>
                </TD>
                <TD>{fmtDate(m.movementDate)}</TD>
                <TD>
                  {fmtDate(m.effectiveDate)}
                  {m.endDate ? ` → ${fmtDate(m.endDate)}` : ""}
                </TD>
                <TD className="max-w-[220px] truncate text-xs" title={m.reason}>
                  {m.reason}
                </TD>
                <TD className="text-xs">
                  {m.requestedBy}
                  <div>{m.approvedBy ?? "—"}</div>
                </TD>
                <TD>
                  <StatusBadge status={m.status} />
                </TD>
                <TD className="space-x-1">
                  {approver && m.status === "PENDING" && (
                    <>
                      <ActionButton action={approveMovementAction.bind(null, m.id)} variant="success">
                        Approve
                      </ActionButton>
                      <ActionButton action={rejectMovementAction.bind(null, m.id)} variant="outline" reason>
                        Reject
                      </ActionButton>
                    </>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!rows.length && <Empty>No movements match.</Empty>}
      </Section>
    </>
  );
}
