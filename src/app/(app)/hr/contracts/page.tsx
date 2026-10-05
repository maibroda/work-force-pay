import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { contractAlerts, listContracts } from "@/server/services/contracts";
import { options, enumOptions } from "@/server/options";
import { fmtDate } from "@/lib/dates";
import { fullName } from "@/lib/utils";
import { FilterBar, FilterField, FormPanel, PageHeader, Section, Empty } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { SmartForm } from "@/components/smart-form";
import { Tabs } from "@/components/tabs";
import { Input, Select } from "@/components/ui/input";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { createContractAction, processExpiredContractsAction } from "@/app/actions/hr-lifecycle";

const TYPES = ["PERMANENT", "FIXED_TERM", "PROBATION", "CASUAL", "CONSULTANT", "INTERNSHIP"];
const STATUSES = ["ACTIVE", "SUPERSEDED", "TERMINATED", "EXPIRED"];

export default async function ContractsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePage("hr.view");
  const sp = await searchParams;
  const tab = sp.tab === "alerts" ? "alerts" : "all";
  const manage = can(ctx.role, "hr.manage");
  const [o, rows, alerts] = await Promise.all([
    options(ctx),
    tab === "all" ? listContracts(ctx, { status: sp.status, type: sp.type, q: sp.q }) : Promise.resolve([]),
    tab === "alerts" ? contractAlerts(ctx) : Promise.resolve(null),
  ]);
  return (
    <>
      <PageHeader
        title="Employment contracts"
        description="Each employee's own terms — type, probation, notice period and renewals. One contract is active at a time; renewals and probation confirmations keep the full history."
      />
      <Tabs
        base="/hr/contracts"
        active={tab}
        tabs={[
          { key: "all", label: "All contracts" },
          { key: "alerts", label: "Alerts & gaps" },
        ]}
      />

      {manage && (
        <FormPanel title="Record a contract for an employee">
          <SmartForm
            columns={3}
            submitLabel="Record contract"
            action={createContractAction}
            fields={[
              { name: "employeeId", label: "Employee", type: "select", required: true, options: o.employees },
              { name: "type", label: "Type", type: "select", required: true, options: enumOptions(TYPES), defaultValue: "PERMANENT" },
              { name: "jobTitle", label: "Job title", required: true },
              { name: "startDate", label: "Start date", type: "date", required: true },
              { name: "endDate", label: "End date", type: "date", help: "Required for fixed-term, casual, consultant and internship." },
              { name: "probationMonths", label: "Probation (months)", type: "number", min: 0, help: "Blank = policy default for a probationary contract, none otherwise." },
              { name: "noticePeriodDays", label: "Notice period (days)", type: "number", min: 0, help: "Blank = HR policy default." },
              { name: "signedDate", label: "Signed on", type: "date" },
              { name: "documentReference", label: "Signed document reference" },
              { name: "notes", label: "Notes", type: "textarea", span: 3 },
            ]}
          />
        </FormPanel>
      )}

      {tab === "all" && (
        <>
          <FilterBar>
            <FilterField label="Search">
              <Input name="q" defaultValue={sp.q ?? ""} placeholder="Employee, number, title" className="w-56" />
            </FilterField>
            <FilterField label="Status">
              <Select name="status" defaultValue={sp.status ?? ""}>
                <option value="">All</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s.charAt(0) + s.slice(1).toLowerCase()}
                  </option>
                ))}
              </Select>
            </FilterField>
            <FilterField label="Type">
              <Select name="type" defaultValue={sp.type ?? ""}>
                <option value="">All</option>
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.replace(/_/g, " ").toLowerCase()}
                  </option>
                ))}
              </Select>
            </FilterField>
          </FilterBar>
          <Section title={`${rows.length} contract(s)`} flush>
            <Table>
              <THead>
                <TR>
                  <TH>Contract</TH>
                  <TH>Employee</TH>
                  <TH>Type</TH>
                  <TH>Job title</TH>
                  <TH>Term</TH>
                  <TH>Probation</TH>
                  <TH className="text-right">Notice</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((c) => {
                  const today = new Date();
                  const pastEnd = c.status === "ACTIVE" && c.endDate && c.endDate < today;
                  return (
                    <TR key={c.id}>
                      <TD className="font-mono text-xs">
                        <Link className="text-primary underline" href={`/hr/contracts/${c.id}`}>
                          {c.contractNumber}
                        </Link>
                      </TD>
                      <TD>
                        <Link className="hover:underline" href={`/employees/${c.employeeId}`}>
                          {c.employee.employeeNumber} — {fullName(c.employee)}
                        </Link>
                      </TD>
                      <TD className="text-xs">{c.type.replace(/_/g, " ")}</TD>
                      <TD>{c.jobTitle}</TD>
                      <TD className="text-xs">
                        {fmtDate(c.startDate)} → {c.endDate ? fmtDate(c.endDate) : "open-ended"}
                      </TD>
                      <TD className="text-xs">{c.probationOutcome ? <StatusBadge status={c.probationOutcome} /> : "—"}</TD>
                      <TD className="text-right">{c.noticePeriodDays}d</TD>
                      <TD>
                        {pastEnd ? <Badge tone="red">PAST END DATE</Badge> : <StatusBadge status={c.status} />}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
            {!rows.length && <Empty>No contracts match.</Empty>}
          </Section>
        </>
      )}

      {alerts && (
        <>
          <Section
            title={`Contracts ending within ${alerts.contractAlertDays} days (${alerts.ending.length})`}
            description="Renew, convert to permanent, or let it lapse — decide before the end date."
            actions={
              manage && (
                <ActionButton action={processExpiredContractsAction} confirm="Mark every contract past its end date as expired?" variant="outline">
                  Mark past-end contracts expired
                </ActionButton>
              )
            }
            flush
          >
            <Table>
              <THead>
                <TR>
                  <TH>Contract</TH>
                  <TH>Employee</TH>
                  <TH>Type</TH>
                  <TH>Ends</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {alerts.ending.map((c) => (
                  <TR key={c.id} className={c.overdue ? "bg-red-50/60" : ""}>
                    <TD className="font-mono text-xs">
                      <Link className="text-primary underline" href={`/hr/contracts/${c.id}`}>
                        {c.contractNumber}
                      </Link>
                    </TD>
                    <TD>
                      {c.employee.employeeNumber} — {fullName(c.employee)}
                    </TD>
                    <TD className="text-xs">{c.type.replace(/_/g, " ")}</TD>
                    <TD className={c.overdue ? "font-medium text-red-700" : ""}>
                      {fmtDate(c.endDate)}
                      {c.overdue ? " (past)" : ""}
                    </TD>
                    <TD>
                      <Link className="text-xs text-primary underline" href={`/hr/contracts/${c.id}`}>
                        Review
                      </Link>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            {!alerts.ending.length && <Empty>No contracts are near their end date.</Empty>}
          </Section>

          <Section title={`Probation reviews due within ${alerts.probationAlertDays} days (${alerts.probation.length})`} flush>
            <Table>
              <THead>
                <TR>
                  <TH>Contract</TH>
                  <TH>Employee</TH>
                  <TH>Probation ends</TH>
                  <TH>Outcome so far</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {alerts.probation.map((c) => (
                  <TR key={c.id} className={c.overdue ? "bg-red-50/60" : ""}>
                    <TD className="font-mono text-xs">{c.contractNumber}</TD>
                    <TD>
                      {c.employee.employeeNumber} — {fullName(c.employee)}
                    </TD>
                    <TD className={c.overdue ? "font-medium text-red-700" : ""}>
                      {fmtDate(c.probationEndDate)}
                      {c.overdue ? " (overdue)" : ""}
                    </TD>
                    <TD>{c.probationOutcome && <StatusBadge status={c.probationOutcome} />}</TD>
                    <TD>
                      <Link className="text-xs text-primary underline" href={`/hr/contracts/${c.id}`}>
                        Decide
                      </Link>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            {!alerts.probation.length && <Empty>No probation reviews are due.</Empty>}
          </Section>

          <Section
            title={`Staff with no active contract on file (${alerts.noContract.length})`}
            description="Most labour laws require each employee to have written terms — record a contract for each."
            flush
          >
            <Table>
              <THead>
                <TR>
                  <TH>Employee</TH>
                  <TH>Employed since</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {alerts.noContract.slice(0, 100).map((e) => (
                  <TR key={e.id}>
                    <TD>
                      <Link className="text-primary underline" href={`/employees/${e.id}?tab=contracts`}>
                        {e.employeeNumber} — {fullName(e)}
                      </Link>
                    </TD>
                    <TD>{fmtDate(e.employmentDate)}</TD>
                    <TD>
                      <StatusBadge status={e.status} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            {!alerts.noContract.length && <Empty>Every active employee has a contract on file.</Empty>}
            {alerts.noContract.length > 100 && (
              <p className="border-t px-4 py-2 text-xs text-muted-foreground">Showing the first 100 of {alerts.noContract.length}.</p>
            )}
          </Section>
        </>
      )}
    </>
  );
}
