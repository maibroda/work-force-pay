import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { getEmployee } from "@/server/services/employees";
import { employeeLocationHistory } from "@/server/services/operations";
import { employeeTimeline } from "@/server/services/hr-overview";
import { listItems, listPacks, outstandingKit } from "@/server/services/inventory";
import { employeePayslips } from "@/server/services/payroll";
import { options, enumOptions } from "@/server/options";
import { d, fmtDate, fmtShort, iso, monthEnd, monthStart, MONTHS } from "@/lib/dates";
import { naira, num } from "@/lib/money";
import { fullName } from "@/lib/utils";
import { FilterBar, FilterField, FormPanel, KV, PageHeader, Section, Empty } from "@/components/page";
import { Tabs } from "@/components/tabs";
import { SmartForm } from "@/components/smart-form";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { employeeFields } from "@/components/forms/fields";
import { createOverrideAction, createPayRateAction, updateEmployeeAction } from "@/app/actions/workforce";
import { createMovementAction, deployAction } from "@/app/actions/operations";
import {
  addDocumentAction,
  addOnboardingTaskAction,
  addTrainingAction,
  approveDisciplinaryAction,
  approveExitAction,
  completeExitTaskAction,
  completeOnboardingTaskAction,
  deleteDocumentAction,
  initiateExitAction,
  raiseDisciplinaryAction,
  rejectDisciplinaryAction,
  rejectExitAction,
  revokeTrainingAction,
} from "@/app/actions/hr";
import { ActionButton } from "@/components/action-button";
import { PersonalRecordsPanel } from "@/components/personal-records-panel";
import { employeeAppraisals } from "@/server/services/appraisals";
import { KIND_LABELS as APPRAISAL_KINDS } from "@/lib/appraisal";
import { createContractAction } from "@/app/actions/hr-lifecycle";
import { generateLetterAction } from "@/app/actions/letters";
import { listLetters } from "@/server/services/letters";
import { LETTER_LABELS } from "@/lib/letters";
import { issueKitAction, issuePackAction, returnHeldAction } from "@/app/actions/inventory";

type SP = Promise<Record<string, string | undefined>>;

export default async function EmployeePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SP;
}) {
  const ctx = await requirePage("employee.view");
  const { id } = await params;
  const sp = await searchParams;
  const e = await getEmployee(ctx, id);
  if (!e) notFound();
  const tab = sp.tab ?? "overview";
  const o = await options(ctx);
  const sensitive = can(ctx.role, "employee.sensitive");
  const hrView = can(ctx.role, "hr.view");
  const hrManage = can(ctx.role, "hr.manage");
  const hrApprove = can(ctx.role, "hr.approve");
  const today = new Date();
  const year = Number(sp.year ?? today.getUTCFullYear());
  const month = Number(sp.month ?? today.getUTCMonth() + 1);
  return (
    <>
      <PageHeader
        title={`${e.employeeNumber} — ${fullName(e)}`}
        crumbs={[{ href: "/employees", label: "Employees" }]}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={e.status} /> {e.category.name} · Current location (operational only):{" "}
            <b>
              {e.currentClient?.name ?? "Unassigned"}
              {e.currentBeat ? ` — ${e.currentBeat.name}` : ""}
            </b>
          </span>
        }
      />
      <Tabs
        base={`/employees/${e.id}`}
        active={tab}
        tabs={[
          { key: "overview", label: "Overview" },
          { key: "assignments", label: "Assignments & movements" },
          { key: "locations", label: "Work locations" },
          { key: "salary", label: "Salary & overrides" },
          ...(sensitive ? [{ key: "contacts", label: "Contacts & guarantors" }] : []),
          ...(hrView
            ? [
                { key: "documents", label: "Documents & training" },
                { key: "conduct", label: "Disciplinary" },
                { key: "lifecycle", label: "Onboarding & exit" },
                { key: "contracts", label: "Contracts" },
                { key: "timeline", label: "Lifecycle timeline" },
                { key: "letters", label: "Letters" },
                ...(can(ctx.role, "appraisal.view") ? [{ key: "appraisals", label: "Appraisals" }] : []),
              ]
            : []),
          ...(can(ctx.role, "inventory.view") ? [{ key: "kit", label: "Kit & uniform" }] : []),
          { key: "payslips", label: "Payslips" },
        ]}
      />

      {tab === "overview" && (
        <>
          <Section title="Employee master">
            <KV
              cols={4}
              items={[
                ["Employee number", <code key="n">{e.employeeNumber}</code>],
                ["Gender", e.gender],
                ["Date of birth", fmtDate(e.dateOfBirth)],
                ["Phone", e.phone],
                ["Email", e.email],
                ["Address", e.address],
                ["Employment date", fmtDate(e.employmentDate)],
                ["Exit date", fmtDate(e.exitDate)],
                ["Department", e.department?.name],
                [
                  "Reports to",
                  e.reportingManager
                    ? `${e.reportingManager.employeeNumber} — ${fullName(e.reportingManager)}`
                    : "—",
                ],
                [
                  "Direct reports",
                  e.directReports.length
                    ? `${e.directReports.length} (${e.directReports.map((r) => r.employeeNumber).join(", ")})`
                    : "—",
                ],
                ["Bank", sensitive ? e.bankName : "••••"],
                ["Account number", sensitive ? e.accountNumber : "••••"],
                ["Account name", sensitive ? e.accountName : "••••"],
                ["Tax ID", sensitive ? e.taxId : "••••"],
                ["Pension PIN", sensitive ? e.pensionPin : "••••"],
                ["PFA", sensitive ? e.pfa : "••••"],
                ["Annual rent (relief)", sensitive && e.annualRent ? naira(e.annualRent) : "—"],
              ]}
            />
          </Section>
          {can(ctx.role, "employee.manage") && (
            <FormPanel title="Edit employee">
              <SmartForm
                fields={[
                  ...employeeFields(o, e as unknown as Record<string, unknown>),
                  { name: "changeReason", label: "Reason for change (audit trail)", span: 3 },
                ]}
                action={updateEmployeeAction.bind(null, e.id)}
                submitLabel="Save changes"
                columns={3}
                resetOnSuccess={false}
              />
            </FormPanel>
          )}
        </>
      )}

      {tab === "assignments" && (
        <>
          {can(ctx.role, "operations.manage") && (
            <div className="grid gap-5 lg:grid-cols-2">
              <FormPanel title="Deploy to a beat">
                <SmartForm
                  fields={[
                    { name: "employeeId", label: "", type: "hidden", defaultValue: e.id },
                    { name: "beatId", label: "Beat", type: "select", required: true, options: o.beats },
                    { name: "startDate", label: "Start date", type: "date", required: true },
                    {
                      name: "categoryId",
                      label: "Category at beat",
                      type: "select",
                      options: o.categories,
                      defaultValue: e.categoryId,
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
              <FormPanel title="Record staff movement">
                <SmartForm
                  fields={[
                    { name: "employeeId", label: "", type: "hidden", defaultValue: e.id },
                    { name: "toBeatId", label: "New beat", type: "select", required: true, options: o.beats },
                    {
                      name: "movementType",
                      label: "Movement type",
                      type: "select",
                      required: true,
                      options: enumOptions([
                        "PERMANENT_TRANSFER",
                        "TEMPORARY_TRANSFER",
                        "RELIEF",
                        "REPLACEMENT",
                        "CLIENT_TRANSFER",
                        "LOCATION_TRANSFER",
                        "SHIFT_CHANGE",
                      ]),
                    },
                    { name: "movementDate", label: "Movement date", type: "date", required: true },
                    { name: "effectiveDate", label: "Effective date", type: "date", required: true },
                    { name: "endDate", label: "End date (temporary/relief)", type: "date" },
                    { name: "reason", label: "Reason", required: true, span: 2 },
                    {
                      name: "approve",
                      label: "Approve immediately",
                      type: "checkbox",
                      defaultValue: can(ctx.role, "movement.approve"),
                    },
                  ]}
                  action={createMovementAction}
                  submitLabel="Save movement"
                />
              </FormPanel>
            </div>
          )}
          <Section title="Deployment history" flush>
            <Table>
              <THead>
                <TR>
                  <TH>Client</TH>
                  <TH>Contract</TH>
                  <TH>Beat</TH>
                  <TH>Category</TH>
                  <TH>From</TH>
                  <TH>To</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {e.deployments.map((x) => (
                  <TR key={x.id}>
                    <TD>{x.client.name}</TD>
                    <TD>{x.contract.contractNumber}</TD>
                    <TD>{x.beat.name}</TD>
                    <TD>{x.category.name}</TD>
                    <TD>{fmtDate(x.startDate)}</TD>
                    <TD>{fmtDate(x.endDate)}</TD>
                    <TD>
                      <StatusBadge status={x.status} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            {!e.deployments.length && <Empty>No deployments.</Empty>}
          </Section>
          <Section title="Staff movements" flush>
            <Table>
              <THead>
                <TR>
                  <TH>Effective</TH>
                  <TH>Type</TH>
                  <TH>From</TH>
                  <TH>To</TH>
                  <TH>Reason</TH>
                  <TH>Approved by</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {e.movements.map((m) => (
                  <TR key={m.id}>
                    <TD>
                      {fmtDate(m.effectiveDate)}
                      {m.endDate ? ` → ${fmtDate(m.endDate)}` : ""}
                    </TD>
                    <TD>{m.movementType.replace(/_/g, " ")}</TD>
                    <TD>
                      {m.fromClient?.name} — {m.fromBeat?.name ?? "—"}
                    </TD>
                    <TD>
                      {m.toClient.name} — {m.toBeat.name}
                    </TD>
                    <TD className="max-w-xs truncate">{m.reason}</TD>
                    <TD>{m.approvedBy ?? "—"}</TD>
                    <TD>
                      <StatusBadge status={m.status} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            {!e.movements.length && <Empty>No movements.</Empty>}
          </Section>
        </>
      )}

      {tab === "locations" && <LocationsTab ctxEmployeeId={e.id} year={year} month={month} ctx={ctx} />}

      {tab === "salary" && (
        <>
          <Section
            title="Employee Salary Overrides"
            description="Component overrides for this employee only — the base structure is never modified."
            flush
          >
            <Table>
              <THead>
                <TR>
                  <TH>Component</TH>
                  <TH>Override</TH>
                  <TH>Effective</TH>
                  <TH>Reason</TH>
                  <TH>Approved by</TH>
                </TR>
              </THead>
              <TBody>
                {e.salaryOverrides.map((x) => (
                  <TR key={x.id}>
                    <TD>
                      <Badge tone="violet">{x.componentCode}</Badge>
                    </TD>
                    <TD>{x.calcType === "PERCENTAGE" ? `${num(x.percentage)}%` : naira(x.fixedAmount)}</TD>
                    <TD>
                      {fmtDate(x.effectiveFrom)} → {fmtDate(x.effectiveTo)}
                    </TD>
                    <TD>{x.reason}</TD>
                    <TD>{x.approvedBy}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            {!e.salaryOverrides.length && <Empty>No overrides.</Empty>}
          </Section>
          <Section
            title="Employee pay rates (effective-dated)"
            description="Used for staff paid a personal monthly gross (e.g. office staff). Guards are normally paid from the contract's agreed rate × 70%."
            flush
          >
            <Table>
              <THead>
                <TR>
                  <TH>Monthly gross</TH>
                  <TH>Structure</TH>
                  <TH>From</TH>
                  <TH>To</TH>
                  <TH>Reason</TH>
                  <TH>Approved by</TH>
                </TR>
              </THead>
              <TBody>
                {e.payRates.map((x) => (
                  <TR key={x.id}>
                    <TD>{naira(x.monthlyGross)}</TD>
                    <TD>{x.structureCode ?? "default"}</TD>
                    <TD>{fmtDate(x.effectiveFrom)}</TD>
                    <TD>{fmtDate(x.effectiveTo)}</TD>
                    <TD>{x.reason}</TD>
                    <TD>{x.approvedBy}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            {!e.payRates.length && <Empty>No personal pay rate — paid from contract agreed rates.</Empty>}
          </Section>
          {can(ctx.role, "override.manage") && (
            <div className="grid gap-5 lg:grid-cols-2">
              <FormPanel title="Add Employee Salary Override">
                <SmartForm
                  fields={[
                    { name: "employeeId", label: "", type: "hidden", defaultValue: e.id },
                    { name: "componentCode", label: "Component code", required: true, placeholder: "BASIC" },
                    {
                      name: "calcType",
                      label: "Type",
                      type: "select",
                      required: true,
                      options: enumOptions(["PERCENTAGE", "FIXED_AMOUNT"]),
                      defaultValue: "PERCENTAGE",
                    },
                    { name: "percentage", label: "Percentage", type: "number", min: 0, max: 100 },
                    { name: "fixedAmount", label: "Fixed amount (₦)", type: "number", min: 0 },
                    { name: "effectiveFrom", label: "Effective date", type: "date", required: true },
                    { name: "effectiveTo", label: "Effective to", type: "date" },
                    { name: "approvedBy", label: "Approved by", required: true },
                    { name: "reason", label: "Reason", required: true, type: "textarea" },
                  ]}
                  action={createOverrideAction}
                  submitLabel="Save override"
                />
              </FormPanel>
              <FormPanel title="Add effective-dated pay rate">
                <SmartForm
                  fields={[
                    { name: "employeeId", label: "", type: "hidden", defaultValue: e.id },
                    {
                      name: "monthlyGross",
                      label: "Monthly gross (₦)",
                      type: "number",
                      required: true,
                      min: 1,
                    },
                    {
                      name: "structureCode",
                      label: "Salary structure",
                      type: "select",
                      options: o.structureCodes,
                    },
                    { name: "effectiveFrom", label: "Effective from", type: "date", required: true },
                    { name: "approvedBy", label: "Approved by", required: true },
                    { name: "reason", label: "Reason", required: true, span: 2 },
                  ]}
                  action={createPayRateAction}
                  submitLabel="Add pay rate"
                />
              </FormPanel>
            </div>
          )}
        </>
      )}

      {tab === "documents" && hrView && (
        <>
          <Section
            title="Documents"
            description="ID, licenses, contracts and certificates on file. Metadata only — the reference is a filename, physical file location or scan reference."
            flush
          >
            <Table>
              <THead>
                <TR>
                  <TH>Type</TH>
                  <TH>Number</TH>
                  <TH>Issue date</TH>
                  <TH>Expiry date</TH>
                  <TH>Reference</TH>
                  <TH>Notes</TH>
                  <TH>Uploaded by</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {e.documents.map((doc) => {
                  const expired = doc.expiryDate && new Date(doc.expiryDate) < new Date();
                  return (
                    <TR key={doc.id} className={expired ? "bg-red-50/60" : ""}>
                      <TD>
                        <Badge tone="blue">{doc.documentType.replace(/_/g, " ")}</Badge>
                      </TD>
                      <TD>{doc.documentNumber ?? "—"}</TD>
                      <TD>{fmtDate(doc.issueDate)}</TD>
                      <TD className={expired ? "font-medium text-red-700" : ""}>
                        {fmtDate(doc.expiryDate)}
                        {expired ? " (expired)" : ""}
                      </TD>
                      <TD className="text-xs">{doc.fileReference}</TD>
                      <TD className="max-w-xs truncate text-xs">{doc.notes ?? "—"}</TD>
                      <TD className="text-xs">{doc.uploadedBy}</TD>
                      <TD>
                        {hrManage && (
                          <ActionButton
                            action={deleteDocumentAction.bind(null, doc.id)}
                            confirm="Remove this document?"
                            variant="outline"
                          >
                            Remove
                          </ActionButton>
                        )}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
            {!e.documents.length && <Empty>No documents on file.</Empty>}
          </Section>
          {hrManage && (
            <FormPanel title="Add document">
              <SmartForm
                columns={3}
                submitLabel="Save document"
                action={addDocumentAction}
                fields={[
                  { name: "employeeId", label: "", type: "hidden", defaultValue: e.id },
                  {
                    name: "documentType",
                    label: "Type",
                    type: "select",
                    required: true,
                    options: enumOptions([
                      "NATIONAL_ID",
                      "PASSPORT",
                      "DRIVERS_LICENSE",
                      "GUARD_LICENSE",
                      "FIREARMS_LICENSE",
                      "MEDICAL_CERTIFICATE",
                      "POLICE_CLEARANCE",
                      "EMPLOYMENT_CONTRACT",
                      "ACADEMIC_CERTIFICATE",
                      "OTHER",
                    ]),
                  },
                  { name: "documentNumber", label: "Document number" },
                  { name: "issueDate", label: "Issue date", type: "date" },
                  { name: "expiryDate", label: "Expiry date", type: "date" },
                  {
                    name: "fileReference",
                    label: "Filename / reference",
                    required: true,
                    placeholder: "e.g. scanned-id-emp001.pdf, filing cabinet ref…",
                    span: 2,
                  },
                  { name: "notes", label: "Notes", type: "textarea", span: 3 },
                ]}
              />
            </FormPanel>
          )}

          <Section
            title="Training & certifications"
            description="Courses, licenses and certifications with their expiry — feeds the compliance expiry report."
            flush
          >
            <Table>
              <THead>
                <TR>
                  <TH>Course / certification</TH>
                  <TH>Provider</TH>
                  <TH>Certificate no.</TH>
                  <TH>Issue date</TH>
                  <TH>Expiry date</TH>
                  <TH>Status</TH>
                  <TH>Recorded by</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {e.trainings.map((t) => {
                  const expired =
                    t.status !== "REVOKED" && t.expiryDate && new Date(t.expiryDate) < new Date();
                  return (
                    <TR key={t.id} className={expired ? "bg-red-50/60" : ""}>
                      <TD>{t.courseName}</TD>
                      <TD>{t.provider ?? "—"}</TD>
                      <TD>{t.certificateNumber ?? "—"}</TD>
                      <TD>{fmtDate(t.issueDate)}</TD>
                      <TD className={expired ? "font-medium text-red-700" : ""}>{fmtDate(t.expiryDate)}</TD>
                      <TD>
                        <StatusBadge status={expired ? "EXPIRED" : t.status} />
                      </TD>
                      <TD className="text-xs">{t.recordedBy}</TD>
                      <TD>
                        {hrManage && t.status === "VALID" && (
                          <ActionButton
                            action={revokeTrainingAction.bind(null, t.id)}
                            reason
                            reasonPlaceholder="Reason for revoking"
                            variant="outline"
                          >
                            Revoke
                          </ActionButton>
                        )}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
            {!e.trainings.length && <Empty>No training / certification records.</Empty>}
          </Section>
          {hrManage && (
            <FormPanel title="Add training / certification">
              <SmartForm
                columns={3}
                submitLabel="Save record"
                action={addTrainingAction}
                fields={[
                  { name: "employeeId", label: "", type: "hidden", defaultValue: e.id },
                  { name: "courseName", label: "Course / certification name", required: true, span: 2 },
                  { name: "provider", label: "Provider / institution" },
                  { name: "certificateNumber", label: "Certificate number" },
                  { name: "issueDate", label: "Issue date", type: "date", required: true },
                  { name: "expiryDate", label: "Expiry date", type: "date" },
                  { name: "fileReference", label: "Filename / reference", span: 3 },
                ]}
              />
            </FormPanel>
          )}
        </>
      )}

      {tab === "conduct" && hrView && (
        <>
          <Section
            title="Disciplinary records & commendations"
            description="Raised as pending, then signed off — maker/checker."
            flush
          >
            <Table>
              <THead>
                <TR>
                  <TH>Incident date</TH>
                  <TH>Type</TH>
                  <TH>Description</TH>
                  <TH>Action taken</TH>
                  <TH>Issued by</TH>
                  <TH>Status</TH>
                  <TH>Approved by</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {e.disciplinaryRecords.map((r) => (
                  <TR key={r.id}>
                    <TD>{fmtDate(r.incidentDate)}</TD>
                    <TD>
                      <Badge tone={r.type === "COMMENDATION" ? "green" : "amber"}>
                        {r.type.replace(/_/g, " ")}
                      </Badge>
                    </TD>
                    <TD className="max-w-xs whitespace-normal text-xs">{r.description}</TD>
                    <TD className="max-w-xs whitespace-normal text-xs">{r.actionTaken ?? "—"}</TD>
                    <TD className="text-xs">{r.issuedBy}</TD>
                    <TD>
                      <StatusBadge status={r.status} />
                    </TD>
                    <TD className="text-xs">{r.approvedBy ?? "—"}</TD>
                    <TD>
                      {hrApprove && r.status === "PENDING" && (
                        <div className="flex gap-1">
                          <ActionButton action={approveDisciplinaryAction.bind(null, r.id)} variant="success">
                            Approve
                          </ActionButton>
                          <ActionButton
                            action={rejectDisciplinaryAction.bind(null, r.id)}
                            reason
                            reasonPlaceholder="Reason for rejecting"
                            variant="outline"
                          >
                            Reject
                          </ActionButton>
                        </div>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            {!e.disciplinaryRecords.length && <Empty>No disciplinary records.</Empty>}
          </Section>
          {hrManage && (
            <FormPanel title="Raise disciplinary record / commendation">
              <SmartForm
                columns={3}
                submitLabel="Raise record"
                action={raiseDisciplinaryAction}
                fields={[
                  { name: "employeeId", label: "", type: "hidden", defaultValue: e.id },
                  {
                    name: "type",
                    label: "Type",
                    type: "select",
                    required: true,
                    options: enumOptions([
                      "QUERY",
                      "VERBAL_WARNING",
                      "WRITTEN_WARNING",
                      "SUSPENSION",
                      "TERMINATION_RECOMMENDATION",
                      "COMMENDATION",
                    ]),
                  },
                  { name: "incidentDate", label: "Incident date", type: "date", required: true },
                  { name: "description", label: "Description", type: "textarea", required: true, span: 3 },
                  { name: "actionTaken", label: "Action taken", type: "textarea", span: 3 },
                ]}
              />
            </FormPanel>
          )}
        </>
      )}

      {tab === "lifecycle" && hrView && (
        <>
          <Section
            title="Onboarding checklist"
            description="Standard tasks are seeded automatically on hire — add extra tasks as needed."
            flush
          >
            <Table>
              <THead>
                <TR>
                  <TH>Task</TH>
                  <TH>Status</TH>
                  <TH>Due date</TH>
                  <TH>Completed by</TH>
                  <TH>Completed at</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {e.onboardingTasks.map((t) => (
                  <TR key={t.id}>
                    <TD>{t.taskName}</TD>
                    <TD>
                      <StatusBadge status={t.status} />
                    </TD>
                    <TD>{fmtDate(t.dueDate)}</TD>
                    <TD className="text-xs">{t.completedBy ?? "—"}</TD>
                    <TD className="text-xs">{t.completedAt ? fmtDate(t.completedAt) : "—"}</TD>
                    <TD>
                      {hrManage && t.status === "PENDING" && (
                        <ActionButton
                          action={completeOnboardingTaskAction.bind(null, t.id)}
                          variant="success"
                        >
                          Mark complete
                        </ActionButton>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            {!e.onboardingTasks.length && <Empty>No onboarding tasks.</Empty>}
          </Section>
          {hrManage && (
            <FormPanel title="Add onboarding task">
              <SmartForm
                columns={3}
                submitLabel="Add task"
                action={addOnboardingTaskAction}
                fields={[
                  { name: "employeeId", label: "", type: "hidden", defaultValue: e.id },
                  { name: "taskName", label: "Task", required: true, span: 2 },
                  { name: "dueDate", label: "Due date", type: "date" },
                ]}
              />
            </FormPanel>
          )}

          <Section
            title="Exit / offboarding"
            description="Initiated as pending, then signed off — approval updates employment status and seeds the clearance checklist."
            flush
          >
            <Table>
              <THead>
                <TR>
                  <TH>Type</TH>
                  <TH>Notice date</TH>
                  <TH>Last working date</TH>
                  <TH>Reason</TH>
                  <TH>Initiated by</TH>
                  <TH>Status</TH>
                  <TH>Settlement</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {e.exitRecords.map((x) => (
                  <TR key={x.id}>
                    <TD>{x.exitType.replace(/_/g, " ")}</TD>
                    <TD>{fmtDate(x.noticeDate)}</TD>
                    <TD>{fmtDate(x.lastWorkingDate)}</TD>
                    <TD className="max-w-xs whitespace-normal text-xs">{x.reason}</TD>
                    <TD className="text-xs">{x.initiatedBy}</TD>
                    <TD>
                      <StatusBadge status={x.status} />
                    </TD>
                    <TD className="text-xs">
                      {x.settlement ? (
                        <Link className="text-primary underline" href={`/payroll/settlements/${x.settlement.id}`}>
                          {x.settlement.settlementNumber} · {x.settlement.status.replace(/_/g, " ").toLowerCase()}
                        </Link>
                      ) : x.status === "APPROVED" ? (
                        <Link className="text-primary underline" href={`/hr/exits/${x.id}`}>
                          Prepare
                        </Link>
                      ) : (
                        "—"
                      )}
                    </TD>
                    <TD>
                      <Link className="mr-2 text-xs text-primary underline" href={`/hr/exits/${x.id}`}>
                        Open
                      </Link>
                      {hrApprove && x.status === "PENDING" && (
                        <div className="flex gap-1">
                          <ActionButton action={approveExitAction.bind(null, x.id)} variant="success">
                            Approve
                          </ActionButton>
                          <ActionButton
                            action={rejectExitAction.bind(null, x.id)}
                            reason
                            reasonPlaceholder="Reason for rejecting"
                            variant="outline"
                          >
                            Reject
                          </ActionButton>
                        </div>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            {!e.exitRecords.length && <Empty>No exit initiated.</Empty>}
            {e.exitRecords
              .filter((x) => x.status === "APPROVED")
              .map((x) => (
                <div key={x.id} className="border-t p-4">
                  <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                    Clearance checklist — {x.exitType.replace(/_/g, " ")}
                  </p>
                  <Table>
                    <THead>
                      <TR>
                        <TH>Task</TH>
                        <TH>Status</TH>
                        <TH>Completed by</TH>
                        <TH />
                      </TR>
                    </THead>
                    <TBody>
                      {x.tasks.map((t) => (
                        <TR key={t.id}>
                          <TD>{t.taskName}</TD>
                          <TD>
                            <StatusBadge status={t.status} />
                          </TD>
                          <TD className="text-xs">{t.completedBy ?? "—"}</TD>
                          <TD>
                            {hrManage && t.status === "PENDING" && (
                              <ActionButton
                                action={completeExitTaskAction.bind(null, t.id)}
                                variant="success"
                              >
                                Mark complete
                              </ActionButton>
                            )}
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </div>
              ))}
          </Section>
          {hrManage && !e.exitRecords.some((x) => x.status === "PENDING") && (
            <FormPanel title="Initiate exit">
              <SmartForm
                columns={3}
                submitLabel="Initiate exit"
                action={initiateExitAction}
                fields={[
                  { name: "employeeId", label: "", type: "hidden", defaultValue: e.id },
                  {
                    name: "exitType",
                    label: "Exit type",
                    type: "select",
                    required: true,
                    options: enumOptions([
                      "RESIGNATION",
                      "TERMINATION",
                      "END_OF_CONTRACT",
                      "RETIREMENT",
                      "ABSCONDMENT",
                      "DECEASED",
                    ]),
                  },
                  { name: "noticeDate", label: "Notice date", type: "date", required: true },
                  { name: "lastWorkingDate", label: "Last working date", type: "date", required: true },
                  {
                    name: "reasonCategory",
                    label: "Reason category",
                    type: "select",
                    options: enumOptions([
                      "BETTER_PAY",
                      "CAREER_GROWTH",
                      "RELOCATION",
                      "PERSONAL_OR_HEALTH",
                      "WORK_CONDITIONS",
                      "MANAGER_RELATIONSHIP",
                      "PERFORMANCE",
                      "MISCONDUCT",
                      "REDUNDANCY",
                      "CONTRACT_END",
                      "RETIREMENT",
                      "DEATH",
                      "OTHER",
                    ]),
                    help: "Redundancy drives severance; the rest feed attrition reporting.",
                  },
                  {
                    name: "summaryDismissal",
                    label: "Summary dismissal (gross misconduct — forfeits notice pay, gratuity & severance)",
                    type: "checkbox",
                    span: 2,
                  },
                  { name: "reason", label: "Reason", type: "textarea", required: true, span: 3 },
                ]}
              />
            </FormPanel>
          )}
        </>
      )}

      {tab === "contracts" && hrView && (
        <>
          <Section
            title="Employment contracts"
            description="One is active at a time; renewals and probation confirmations keep the history."
            flush
          >
            <Table>
              <THead>
                <TR>
                  <TH>Contract</TH>
                  <TH>Type</TH>
                  <TH>Job title</TH>
                  <TH>Term</TH>
                  <TH>Probation</TH>
                  <TH>Notice</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {e.employmentContracts.map((c) => (
                  <TR key={c.id}>
                    <TD className="font-mono text-xs">
                      <Link className="text-primary underline" href={`/hr/contracts/${c.id}`}>
                        {c.contractNumber}
                      </Link>
                    </TD>
                    <TD className="text-xs">{c.type.replace(/_/g, " ").toLowerCase()}</TD>
                    <TD>{c.jobTitle}</TD>
                    <TD className="text-xs">
                      {fmtDate(c.startDate)} → {c.endDate ? fmtDate(c.endDate) : "open-ended"}
                    </TD>
                    <TD className="text-xs">{c.probationOutcome ? <StatusBadge status={c.probationOutcome} /> : "—"}</TD>
                    <TD className="text-xs">{c.noticePeriodDays}d</TD>
                    <TD>
                      <StatusBadge status={c.status} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            {!e.employmentContracts.length && <Empty>No contract on file for this employee.</Empty>}
          </Section>
          {hrManage &&
            !e.employmentContracts.some((c) => c.status === "ACTIVE") &&
            !["EXITED", "TERMINATED", "RESIGNED"].includes(e.status) && (
              <FormPanel title="Record a contract" open={!e.employmentContracts.length}>
                <SmartForm
                  columns={3}
                  submitLabel="Record contract"
                  action={createContractAction}
                  fields={[
                    { name: "employeeId", label: "", type: "hidden", defaultValue: e.id },
                    {
                      name: "type",
                      label: "Type",
                      type: "select",
                      required: true,
                      defaultValue: "PERMANENT",
                      options: enumOptions(["PERMANENT", "FIXED_TERM", "PROBATION", "CASUAL", "CONSULTANT", "INTERNSHIP"]),
                    },
                    { name: "jobTitle", label: "Job title", required: true, defaultValue: e.category.name },
                    { name: "startDate", label: "Start date", type: "date", required: true, defaultValue: iso(e.employmentDate) },
                    { name: "endDate", label: "End date", type: "date", help: "Needed for fixed-term, casual, consultant, internship." },
                    { name: "probationMonths", label: "Probation (months)", type: "number", min: 0 },
                    { name: "noticePeriodDays", label: "Notice period (days)", type: "number", min: 0 },
                  ]}
                />
              </FormPanel>
            )}
        </>
      )}

      {tab === "timeline" && hrView && <TimelineTab employeeId={e.id} ctx={ctx} />}

      {tab === "letters" && hrView && <LettersTab employee={e} ctx={ctx} />}

      {tab === "kit" && can(ctx.role, "inventory.view") && (
        <KitTab employeeId={e.id} active={!["EXITED", "TERMINATED", "RESIGNED"].includes(e.status)} ctx={ctx} />
      )}

      {tab === "appraisals" && hrView && can(ctx.role, "appraisal.view") && <AppraisalsTab employeeId={e.id} ctx={ctx} />}

      {tab === "contacts" && sensitive && (
        <PersonalRecordsPanel ctx={ctx} employeeId={e.id} base={`/employees/${e.id}?tab=contacts`} edit={sp.edit} editGuarantor={sp.editg} />
      )}

      {tab === "payslips" && <PayslipsTab employeeId={e.id} ctx={ctx} />}
    </>
  );
}

async function LocationsTab({
  ctx,
  ctxEmployeeId,
  year,
  month,
}: {
  ctx: Awaited<ReturnType<typeof requirePage>>;
  ctxEmployeeId: string;
  year: number;
  month: number;
}) {
  const ranges = await employeeLocationHistory(
    ctx,
    ctxEmployeeId,
    monthStart(year, month),
    monthEnd(year, month),
  );
  return (
    <Section
      title={`Work locations — ${MONTHS[month - 1]} ${year}`}
      description="From the Work Register (the operational source of truth), not the current location."
    >
      <FilterBar>
        <input type="hidden" name="tab" value="locations" />
        <FilterField label="Month">
          <Select name="month" defaultValue={String(month)}>
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </Select>
        </FilterField>
        <FilterField label="Year">
          <Select name="year" defaultValue={String(year)}>
            {[2025, 2026, 2027].map((y) => (
              <option key={y}>{y}</option>
            ))}
          </Select>
        </FilterField>
      </FilterBar>
      {ranges.length ? (
        <ol className="space-y-2">
          {ranges.map((r, i) => (
            <li key={i} className="flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm">
              <span className="w-32 font-mono text-xs">
                {fmtShort(d(r.from))} – {fmtShort(d(r.to))}
              </span>
              <span className="font-medium">
                {r.clientName} — {r.beatName}
              </span>
              <Badge tone="blue">{r.days} paid day(s)</Badge>
            </li>
          ))}
        </ol>
      ) : (
        <Empty>No work register records for this month.</Empty>
      )}
    </Section>
  );
}

async function AppraisalsTab({ ctx, employeeId }: { ctx: Awaited<ReturnType<typeof requirePage>>; employeeId: string }) {
  const rows = await employeeAppraisals(ctx, employeeId);
  return (
    <Section title="Appraisal history" description="Every review this employee has been part of, newest first." flush>
      <Table>
        <THead>
          <TR>
            <TH>Cycle</TH>
            <TH>Type</TH>
            <TH>Period</TH>
            <TH>Status</TH>
            <TH>Result</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((a) => (
            <TR key={a.id}>
              <TD>
                <Link className="text-primary underline" href={`/hr/appraisals/${a.id}`}>
                  {a.cycle.name}
                </Link>
              </TD>
              <TD className="text-xs">{APPRAISAL_KINDS[a.cycle.kind]}</TD>
              <TD className="text-xs">
                {fmtDate(a.cycle.periodStart)} – {fmtDate(a.cycle.periodEnd)}
              </TD>
              <TD>
                <StatusBadge status={a.status} />
              </TD>
              <TD className="text-xs">{a.overallScore != null ? `${num(a.overallScore).toFixed(2)} — ${a.overallBand}` : "—"}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
      {!rows.length && <Empty>No appraisals yet.</Empty>}
    </Section>
  );
}

async function LettersTab({
  ctx,
  employee: e,
}: {
  ctx: Awaited<ReturnType<typeof requirePage>>;
  employee: NonNullable<Awaited<ReturnType<typeof getEmployee>>>;
}) {
  const manage = can(ctx.role, "hr.manage");
  const letters = await listLetters(ctx, { employeeId: e.id });
  const gone = ["EXITED", "TERMINATED", "RESIGNED"].includes(e.status);
  const gen = (type: string, extra: Record<string, string> = {}) => generateLetterAction.bind(null, { type, employeeId: e.id, ...extra });
  const buttons: Array<{ label: string; action: ReturnType<typeof gen> }> = [];
  if (!gone) buttons.push({ label: "Employment confirmation", action: gen("EMPLOYMENT_CONFIRMATION") });
  if (e.employmentContracts.some((c) => c.probationOutcome === "CONFIRMED")) buttons.push({ label: "Probation confirmation", action: gen("PROBATION_CONFIRMATION") });
  if (gone && e.exitDate) buttons.push({ label: "Experience letter", action: gen("EXPERIENCE") });
  for (const x of e.exitRecords.filter((r) => r.status === "APPROVED")) {
    buttons.push({ label: `Exit letter (${fmtShort(x.lastWorkingDate)})`, action: gen("EXIT_LETTER", { exitRecordId: x.id }) });
    buttons.push({ label: `Clearance certificate (${fmtShort(x.lastWorkingDate)})`, action: gen("CLEARANCE_CERTIFICATE", { exitRecordId: x.id }) });
  }
  for (const r of e.disciplinaryRecords.filter((x) => x.status === "APPROVED" && x.type !== "COMMENDATION"))
    buttons.push({ label: `Warning letter — ${r.type.replace(/_/g, " ").toLowerCase()} (${fmtShort(r.incidentDate)})`, action: gen("WARNING", { disciplinaryId: r.id }) });
  return (
    <>
      <Section title="Letters issued" description="Stored exactly as issued — later changes to the wording never alter them." flush>
        <Table>
          <THead>
            <TR>
              <TH>Reference</TH>
              <TH>Letter</TH>
              <TH>Subject</TH>
              <TH>Issued</TH>
              <TH>By</TH>
            </TR>
          </THead>
          <TBody>
            {letters.map((l) => (
              <TR key={l.id}>
                <TD className="font-mono text-xs">
                  <Link className="text-primary underline" href={`/hr/letters/${l.id}`}>
                    {l.referenceNumber}
                  </Link>
                </TD>
                <TD>{LETTER_LABELS[l.type]}</TD>
                <TD className="max-w-xs truncate text-xs">{l.subject}</TD>
                <TD className="text-xs">{fmtDate(l.createdAt)}</TD>
                <TD className="text-xs">{l.generatedBy}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!letters.length && <Empty>No letters issued to this employee.</Empty>}
      </Section>
      {manage && (
        <Section title="Generate a letter" description="Only the letters this employee's records support are offered — an experience letter needs a leaver, a clearance certificate needs finished clearance, a warning needs a signed-off record.">
          {buttons.length ? (
            <div className="flex flex-wrap gap-2">
              {buttons.map((b) => (
                <ActionButton key={b.label} action={b.action} variant="outline">
                  {b.label}
                </ActionButton>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No letters are available for this employee yet.</p>
          )}
        </Section>
      )}
    </>
  );
}

async function KitTab({
  ctx,
  employeeId,
  active,
}: {
  ctx: Awaited<ReturnType<typeof requirePage>>;
  employeeId: string;
  active: boolean;
}) {
  const manage = can(ctx.role, "inventory.manage");
  const [held, items, packs] = await Promise.all([outstandingKit(ctx, employeeId), listItems(ctx), listPacks(ctx)]);
  return (
    <>
      <Section
        title="Uniform & kit held"
        description="Issued and not yet returned. Kit still held when someone leaves can be added to their end-of-service settlement as a recovery."
        flush
      >
        <Table>
          <THead>
            <TR>
              <TH>Item</TH>
              <TH className="text-right">Issued</TH>
              <TH className="text-right">Returned</TH>
              <TH className="text-right">Held</TH>
              <TH className="text-right">Value</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {held.map((r) => (
              <TR key={r.item.id}>
                <TD>
                  <Link className="text-primary underline" href={`/inventory/${r.item.id}`}>
                    {r.item.sku}
                  </Link>{" "}
                  {r.item.name}
                  {r.item.size ? ` — ${r.item.size}` : ""}
                </TD>
                <TD className="text-right">{r.issued}</TD>
                <TD className="text-right">{r.returned}</TD>
                <TD className="text-right font-medium">{r.outstanding}</TD>
                <TD className="text-right">{naira(r.value)}</TD>
                <TD>
                  {manage && (
                    <div className="flex flex-wrap gap-1">
                      <ActionButton action={returnHeldAction.bind(null, employeeId, r.item.id, r.outstanding, "GOOD", undefined)} variant="success">
                        Returned
                      </ActionButton>
                      <ActionButton action={returnHeldAction.bind(null, employeeId, r.item.id, r.outstanding, "DAMAGED")} reason reasonPlaceholder="What's wrong with it?" variant="outline">
                        Damaged
                      </ActionButton>
                      <ActionButton action={returnHeldAction.bind(null, employeeId, r.item.id, r.outstanding, "LOST")} reason reasonPlaceholder="What happened to it?" variant="outline">
                        Lost
                      </ActionButton>
                    </div>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!held.length && <Empty>This employee isn&apos;t holding any kit.</Empty>}
      </Section>
      {manage && active && (
        <div className="grid gap-5 lg:grid-cols-2">
          <FormPanel title="Issue a kit pack">
            <SmartForm
              columns={1}
              submitLabel="Issue pack"
              action={issuePackAction}
              fields={[
                { name: "employeeId", label: "", type: "hidden", defaultValue: employeeId },
                {
                  name: "packId",
                  label: "Pack",
                  type: "select",
                  required: true,
                  options: packs.filter((p) => p.active).map((p) => ({ value: p.id, label: `${p.name} — ${p.setsAvailable} set(s) in stock` })),
                  help: "All items are issued together, or none if anything is short.",
                },
              ]}
            />
          </FormPanel>
          <FormPanel title="Issue an item">
            <SmartForm
              columns={2}
              submitLabel="Issue"
              action={issueKitAction}
              fields={[
                { name: "employeeId", label: "", type: "hidden", defaultValue: employeeId },
                {
                  name: "itemId",
                  label: "Item",
                  type: "select",
                  required: true,
                  span: 2,
                  options: items.map((i) => ({ value: i.id, label: `${i.sku} — ${i.name}${i.size ? ` (${i.size})` : ""} · ${i.quantityOnHand} in stock` })),
                },
                { name: "quantity", label: "Quantity", type: "number", required: true, min: 1, defaultValue: 1 },
                { name: "reference", label: "Reference" },
              ]}
            />
          </FormPanel>
        </div>
      )}
    </>
  );
}

async function TimelineTab({
  ctx,
  employeeId,
}: {
  ctx: Awaited<ReturnType<typeof requirePage>>;
  employeeId: string;
}) {
  const events = await employeeTimeline(ctx, employeeId);
  const tone = { blue: "blue", green: "green", amber: "amber", red: "red", slate: "gray" } as const;
  return (
    <Section
      title="Lifecycle timeline"
      description="Everything that has happened to this employee — joining, contracts and probation, movements, pay changes, conduct, leave, training and exit — newest first."
    >
      <ol className="space-y-2">
        {events.map((ev, i) => (
          <li key={i} className="flex flex-wrap items-start gap-3 rounded-md border p-3 text-sm">
            <span className="w-24 shrink-0 font-mono text-xs text-muted-foreground">{fmtDate(ev.date)}</span>
            <Badge tone={tone[ev.tone]}>{ev.kind}</Badge>
            <span className="flex-1">
              <span className="font-medium">{ev.title}</span>
              {ev.detail && <span className="block text-xs text-muted-foreground">{ev.detail}</span>}
            </span>
          </li>
        ))}
      </ol>
      {!events.length && <Empty>Nothing recorded yet.</Empty>}
    </Section>
  );
}

async function PayslipsTab({
  ctx,
  employeeId,
}: {
  ctx: Awaited<ReturnType<typeof requirePage>>;
  employeeId: string;
}) {
  const slips = await employeePayslips(ctx, employeeId);
  return (
    <Section title="Payslips" flush>
      <Table>
        <THead>
          <TR>
            <TH>Period</TH>
            <TH>Run</TH>
            <TH className="text-right">Gross</TH>
            <TH className="text-right">Net</TH>
            <TH>Status</TH>
            <TH />
          </TR>
        </THead>
        <TBody>
          {slips.map((s) => (
            <TR key={s.id}>
              <TD>{s.run.period.name}</TD>
              <TD>{s.run.type}</TD>
              <TD className="text-right">{naira(s.totalEarnings)}</TD>
              <TD className="text-right">{naira(s.netPay)}</TD>
              <TD>
                <StatusBadge status={s.run.status} />
              </TD>
              <TD>
                <Link className="text-primary underline" href={`/payslips/${s.id}`}>
                  View payslip
                </Link>
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
      {!slips.length && <Empty>No approved payslips yet.</Empty>}
    </Section>
  );
}
