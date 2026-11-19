import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { fmtDate } from "@/lib/dates";
import { naira, num } from "@/lib/money";
import { compensationTypeOn } from "@/lib/payroll/hourly-rates";
import { hourlyPayEnabled, listCompensationTypes, listHourlyRates } from "@/server/services/hourly-pay";
import { options } from "@/server/options";
import { Empty, FormPanel, PageHeader, Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { ActionButton } from "@/components/action-button";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import {
  approveCompensationTypeAction,
  approveHourlyRateAction,
  cancelCompensationTypeAction,
  cancelHourlyRateAction,
  proposeCompensationTypeAction,
  proposeHourlyRateAction,
  rejectCompensationTypeAction,
  rejectHourlyRateAction,
  setHourlyPayAction,
} from "@/app/actions/hourly-pay";

const SCOPE_LABEL: Record<string, string> = { EMPLOYEE: "One employee", CONTRACT_CATEGORY: "A contract and job role", CATEGORY: "A job role" };

export default async function HourlyPayPage() {
  const ctx = await requirePage("payroll.view");
  const enabled = await hourlyPayEnabled(ctx.orgId);
  const switchRight = can(ctx.role, "settings.manage");
  if (!enabled)
    return (
      <>
        <PageHeader title="Hourly pay" description="Paying some employees by the hour, at one rate for weekdays, one for weekends and one for public holidays." />
        <Section title="Hourly pay is not switched on for this company">
          <p className="text-sm text-muted-foreground">
            Nothing here is in use. When it is switched on you can agree hourly rates (proposed by the payroll team, approved by a payroll manager) and record who is paid by the hour. The pay run does not use them yet: it still pays every employee as it always has.
          </p>
          {switchRight ? (
            <div className="mt-3">
              <ActionButton action={setHourlyPayAction.bind(null, true)} confirm="Switch hourly pay on for this company?" variant="success">
                Switch hourly pay on
              </ActionButton>
            </div>
          ) : (
            <p className="mt-3 text-sm">A company administrator can switch it on.</p>
          )}
        </Section>
      </>
    );
  const [{ rates }, { records }, o] = await Promise.all([listHourlyRates(ctx), listCompensationTypes(ctx), options(ctx)]);
  const propose = can(ctx.role, "payroll.run");
  const approve = can(ctx.role, "payrate.approve");
  const today = new Date();
  const inForce = rates.filter((r) => r.status === "APPROVED" && r.effectiveFrom <= today && (!r.effectiveTo || r.effectiveTo >= today));
  const pending = rates.filter((r) => r.status === "PENDING");
  const history = rates.filter((r) => r.status !== "PENDING");
  const whom = (r: (typeof rates)[number]) =>
    r.scope === "EMPLOYEE" && r.employee
      ? `${r.employee.employeeNumber} — ${r.employee.firstName} ${r.employee.lastName}`
      : r.scope === "CONTRACT_CATEGORY" && r.contract
        ? `${r.contract.contractNumber} — ${r.contract.client.name}: ${r.contract.name}, ${r.category?.name ?? ""}`
        : `${r.category?.name ?? ""} (every employee in the role)`;
  const rateCells = (r: (typeof rates)[number]) => (
    <>
      <TD className="text-right">{naira(num(r.weekdayRate))}</TD>
      <TD className="text-right">{naira(num(r.weekendRate))}</TD>
      <TD className="text-right">{naira(num(r.holidayRate))}</TD>
    </>
  );
  const hourly = records.filter((r) => r.status === "APPROVED");
  const byPerson = new Map<string, typeof records>();
  for (const r of hourly) byPerson.set(r.employeeId, [...(byPerson.get(r.employeeId) ?? []), r]);
  const hourlyNow = [...byPerson.values()].filter((rows) => compensationTypeOn(rows, today) === "HOURLY");
  const pendingTypes = records.filter((r) => r.status === "PENDING");
  return (
    <>
      <PageHeader
        title="Hourly pay"
        description="The hourly rates agreed for weekdays, weekends and public holidays, and who is paid by the hour. The pay run does not use these yet: it still pays every employee as it always has. A rate counts only when a second person has approved it, and nothing is overwritten."
        actions={
          switchRight ? (
            <ActionButton action={setHourlyPayAction.bind(null, false)} confirm="Switch hourly pay off? Nothing already agreed is deleted." variant="outline">
              Switch off
            </ActionButton>
          ) : undefined
        }
      />
      <Section title="Hourly rates in force today" description="The most specific applies: the employee's own, then the contract and job role, then the job role." flush>
        {inForce.length ? (
          <Table>
            <THead>
              <TR>
                <TH>For</TH>
                <TH>Applies to</TH>
                <TH className="text-right">Weekday / hour</TH>
                <TH className="text-right">Weekend / hour</TH>
                <TH className="text-right">Public holiday / hour</TH>
                <TH>From</TH>
              </TR>
            </THead>
            <TBody>
              {inForce.map((r) => (
                <TR key={r.id}>
                  <TD>{SCOPE_LABEL[r.scope]}</TD>
                  <TD>{whom(r)}</TD>
                  {rateCells(r)}
                  <TD>{fmtDate(r.effectiveFrom)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <Empty>No hourly rate is in force.</Empty>
        )}
      </Section>
      <Section title={`Rates waiting for approval (${pending.length})`} flush>
        {pending.length ? (
          <Table>
            <THead>
              <TR>
                <TH>Applies to</TH>
                <TH className="text-right">Weekday</TH>
                <TH className="text-right">Weekend</TH>
                <TH className="text-right">Holiday</TH>
                <TH>From</TH>
                <TH>Reason</TH>
                <TH>Proposed by</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {pending.map((r) => (
                <TR key={r.id}>
                  <TD>{whom(r)}</TD>
                  {rateCells(r)}
                  <TD>{fmtDate(r.effectiveFrom)}</TD>
                  <TD className="max-w-xs whitespace-normal text-xs">{r.reason}</TD>
                  <TD className="text-xs">{r.proposedBy}</TD>
                  <TD className="space-x-1 whitespace-nowrap text-right">
                    {approve && r.proposedByUserId !== ctx.userId && (
                      <>
                        <ActionButton action={approveHourlyRateAction.bind(null, r.id)} confirm="Approve this hourly rate? It applies from its date." variant="success">
                          Approve
                        </ActionButton>
                        <ActionButton action={rejectHourlyRateAction.bind(null, r.id)} reason variant="outline">
                          Reject
                        </ActionButton>
                      </>
                    )}
                    {r.proposedByUserId === ctx.userId && (
                      <ActionButton action={cancelHourlyRateAction.bind(null, r.id)} confirm="Withdraw this proposal?" variant="outline">
                        Withdraw
                      </ActionButton>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <Empty>Nothing waiting.</Empty>
        )}
      </Section>
      {propose && (
        <FormPanel title="Propose an hourly rate">
          <SmartForm
            columns={3}
            submitLabel="Propose"
            action={proposeHourlyRateAction}
            fields={[
              { name: "scope", label: "The rate is for", type: "select", required: true, options: [{ value: "CATEGORY", label: "A job role (everyone in it)" }, { value: "CONTRACT_CATEGORY", label: "A contract and job role" }, { value: "EMPLOYEE", label: "One employee" }] },
              { name: "categoryId", label: "Job role (job role, or contract and job role)", type: "select", options: o.categories },
              { name: "contractId", label: "Contract (contract and job role only)", type: "select", options: o.contracts },
              { name: "employeeId", label: "Employee (one employee only)", type: "select", options: o.employees },
              { name: "effectiveFrom", label: "From", type: "date", required: true },
              { name: "weekdayRate", label: "Weekday rate per hour (₦)", required: true, placeholder: "e.g. 1000.00" },
              { name: "weekendRate", label: "Weekend rate per hour (₦)", required: true },
              { name: "holidayRate", label: "Public holiday rate per hour (₦)", required: true },
              { name: "reason", label: "Why (what was agreed)", required: true, span: 3 },
            ]}
          />
        </FormPanel>
      )}
      <Section title={`Who is paid by the hour today (${hourlyNow.length})`} description="Everyone else is paid monthly, as before. A change counts from its date, after a second person approves it." flush>
        {hourlyNow.length ? (
          <Table>
            <THead>
              <TR>
                <TH>Employee</TH>
                <TH>Hourly from</TH>
              </TR>
            </THead>
            <TBody>
              {hourlyNow.map((rows) => {
                const latest = [...rows].filter((r) => r.effectiveFrom <= today).sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0];
                return (
                  <TR key={latest.id}>
                    <TD>
                      {latest.employee.employeeNumber} — {latest.employee.firstName} {latest.employee.lastName}
                    </TD>
                    <TD>{fmtDate(latest.effectiveFrom)}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        ) : (
          <Empty>Nobody is paid by the hour.</Empty>
        )}
      </Section>
      <Section title={`How people are paid: waiting for approval (${pendingTypes.length})`} flush>
        {pendingTypes.length ? (
          <Table>
            <THead>
              <TR>
                <TH>Employee</TH>
                <TH>Paid</TH>
                <TH>From</TH>
                <TH>Reason</TH>
                <TH>Proposed by</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {pendingTypes.map((r) => (
                <TR key={r.id}>
                  <TD>
                    {r.employee.employeeNumber} — {r.employee.firstName} {r.employee.lastName}
                  </TD>
                  <TD>{r.type === "HOURLY" ? "By the hour" : "Monthly"}</TD>
                  <TD>{fmtDate(r.effectiveFrom)}</TD>
                  <TD className="max-w-xs whitespace-normal text-xs">{r.reason}</TD>
                  <TD className="text-xs">{r.proposedBy}</TD>
                  <TD className="space-x-1 whitespace-nowrap text-right">
                    {approve && r.proposedByUserId !== ctx.userId && (
                      <>
                        <ActionButton action={approveCompensationTypeAction.bind(null, r.id)} confirm="Approve this? It applies from its date." variant="success">
                          Approve
                        </ActionButton>
                        <ActionButton action={rejectCompensationTypeAction.bind(null, r.id)} reason variant="outline">
                          Reject
                        </ActionButton>
                      </>
                    )}
                    {r.proposedByUserId === ctx.userId && (
                      <ActionButton action={cancelCompensationTypeAction.bind(null, r.id)} confirm="Withdraw this proposal?" variant="outline">
                        Withdraw
                      </ActionButton>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <Empty>Nothing waiting.</Empty>
        )}
      </Section>
      {propose && (
        <FormPanel title="Change how an employee is paid">
          <SmartForm
            columns={2}
            submitLabel="Propose"
            action={proposeCompensationTypeAction}
            fields={[
              { name: "employeeId", label: "Employee", type: "select", required: true, options: o.employees },
              { name: "type", label: "Paid", type: "select", required: true, options: [{ value: "HOURLY", label: "By the hour" }, { value: "MONTHLY", label: "Monthly" }] },
              { name: "effectiveFrom", label: "From", type: "date", required: true, help: "Not inside a payroll period that is already approved or locked." },
              { name: "reason", label: "Why", required: true },
            ]}
          />
        </FormPanel>
      )}
      {history.length > 0 && (
        <Section title="Rate history" description="Every rate ever proposed. Nothing is overwritten or deleted." flush>
          <Table>
            <THead>
              <TR>
                <TH>Applies to</TH>
                <TH className="text-right">Weekday</TH>
                <TH className="text-right">Weekend</TH>
                <TH className="text-right">Holiday</TH>
                <TH>From</TH>
                <TH>To</TH>
                <TH>Status</TH>
                <TH>Decided by</TH>
              </TR>
            </THead>
            <TBody>
              {history.map((r) => (
                <TR key={r.id}>
                  <TD>{whom(r)}</TD>
                  {rateCells(r)}
                  <TD>{fmtDate(r.effectiveFrom)}</TD>
                  <TD>{fmtDate(r.effectiveTo)}</TD>
                  <TD>
                    <StatusBadge status={r.status} />
                  </TD>
                  <TD className="text-xs">{r.decidedBy ?? "—"}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Section>
      )}
    </>
  );
}
