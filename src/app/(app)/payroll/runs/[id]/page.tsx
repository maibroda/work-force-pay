import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { getRunDetail, listRecords } from "@/server/services/payroll";
import { compactNaira, naira, num } from "@/lib/money";
import { fmtDate } from "@/lib/dates";
import { FilterBar, FilterField, PageHeader, Section, Stat, StatGrid, Empty } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR, TFoot } from "@/components/ui/table";
import {
  approveRunAction,
  createBatchesAction,
  generateRemittancesAction,
  lockRunAction,
  overrideIssueAction,
  returnRunAction,
  runPayrollAction,
  submitRunAction,
} from "@/app/actions/payroll";

const CATS = [
  "POPULATION",
  "SALARY",
  "ATTENDANCE",
  "LOCATION",
  "BANK",
  "PENSION",
  "PAYE",
  "OVERTIME",
  "ARREARS",
  "DEDUCTIONS",
  "DUPLICATES",
];

export default async function RunPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requirePage("payroll.view");
  const { id } = await params;
  const sp = await searchParams;
  const run = await getRunDetail(ctx, id);
  if (!run) notFound();
  const records = await listRecords(ctx, id, sp.q);
  const open = run.issues.filter((i) => !i.resolved && !i.overridden);
  const crit = open.filter((i) => i.severity === "CRITICAL");
  const warn = open.filter((i) => i.severity === "WARNING");
  const cat = sp.cat;
  const sev = sp.sev;
  const shown = run.issues.filter((i) => (!cat || i.category === cat) && (!sev || i.severity === sev));
  const periodOpen = !["APPROVED", "LOCKED", "PAID", "CLOSED"].includes(run.period.status);
  const isRegular = run.type === "REGULAR";
  const sum = (k: keyof (typeof records)[number]) => records.reduce((a, r) => a + num(r[k]), 0);
  return (
    <>
      <PageHeader
        title={`Payroll Control Centre — ${run.period.name}`}
        crumbs={[{ href: "/payroll/runs", label: "Payroll runs" }]}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={run.type} /> Run #{run.runNumber} <StatusBadge status={run.status} /> ·
            Period <StatusBadge status={run.period.status} /> · calculated {run.calculationCount}× · last by{" "}
            {run.calculatedBy ?? "—"}{" "}
            {run.calculatedAt ? `on ${run.calculatedAt.toLocaleString("en-GB")}` : ""} · PAYE rule{" "}
            <code className="text-xs">{run.taxRuleVersion}</code>
          </span>
        }
        actions={
          <>
            {isRegular && periodOpen && can(ctx.role, "payroll.run") && (
              <ActionButton action={runPayrollAction.bind(null, run.periodId)} variant="outline">
                Recalculate
              </ActionButton>
            )}
            {run.status === "CALCULATED" && can(ctx.role, "payroll.run") && (
              <ActionButton action={submitRunAction.bind(null, run.id)}>Submit for approval</ActionButton>
            )}
            {run.status === "PENDING_APPROVAL" && can(ctx.role, "payroll.approve") && (
              <ActionButton action={approveRunAction.bind(null, run.id)} variant="success">
                Approve payroll
              </ActionButton>
            )}
            {["PENDING_APPROVAL", "APPROVED"].includes(run.status) && can(ctx.role, "payroll.approve") && (
              <ActionButton action={returnRunAction.bind(null, run.id)} reason variant="outline">
                Return for correction
              </ActionButton>
            )}
            {run.status === "APPROVED" && can(ctx.role, "payroll.lock") && (
              <ActionButton
                action={lockRunAction.bind(null, run.id)}
                confirm="Lock payroll? Operational edits stop."
                variant="destructive"
              >
                Lock payroll
              </ActionButton>
            )}
            {run.status === "LOCKED" && can(ctx.role, "payment.manage") && (
              <>
                <ActionButton action={createBatchesAction.bind(null, run.id)}>
                  Create payment batches
                </ActionButton>
                <ActionButton action={generateRemittancesAction.bind(null, run.id)} variant="outline">
                  Generate remittances
                </ActionButton>
              </>
            )}
          </>
        }
      />
      <StatGrid cols={6}>
        <Stat
          label="Critical errors"
          value={crit.length}
          tone={crit.length ? "red" : "green"}
          sub={crit.length ? "Approval blocked" : "Clear"}
        />
        <Stat label="Warnings" value={warn.length} tone={warn.length ? "amber" : "green"} />
        <Stat label="Employees" value={run.employeeCount} />
        <Stat label="Gross payroll" value={compactNaira(run.totalGross)} sub={naira(run.totalGross)} />
        <Stat label="Net payroll" value={compactNaira(run.totalNet)} sub={naira(run.totalNet)} />
        <Stat label="PAYE" value={compactNaira(run.totalPaye)} />
        <Stat label="Employee pension" value={compactNaira(run.totalEmployeePension)} />
        <Stat label="Employer pension" value={compactNaira(run.totalEmployerPension)} />
        <Stat label="Overtime" value={compactNaira(run.totalOvertime)} />
        <Stat label="Arrears" value={compactNaira(run.totalArrears)} />
        <Stat label="Client billing" value={compactNaira(run.totalClientBilling)} />
        <Stat label="Management share" value={compactNaira(run.totalManagementShare)} />
        <Stat
          label="Employer add-on costs"
          value={compactNaira(run.totalEmployerAddOns)}
          sub="ITF, NSITF, insurance, …"
        />
      </StatGrid>

      {num(run.totalEmployerAddOns) > 0 && (
        <Section
          title="Employer add-on costs"
          description="Guarding / outsourcing costs beyond employer pension (see Settings → Employer Cost Rules). Zero for back-office pay."
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {(
              [
                { label: "ITF", value: run.totalItf },
                { label: "NSITF-ECA", value: run.totalNsitf },
                { label: "NHF / Medical", value: run.totalNhfMedical },
                { label: "Insurance", value: run.totalInsurance },
                { label: "Uniform & Kits", value: run.totalUniformKits },
                { label: "Recruitment/Training", value: run.totalRecruitmentTraining },
                { label: "Leave Reliever", value: run.totalLeaveReliever },
                { label: "Outsourcing Leave Allow.", value: run.totalOutsourcingLeaveAllowance },
              ] as const
            ).map(({ label, value }) => (
              <div key={label} className="rounded-md border p-2 text-center">
                <p className="text-[11px] text-muted-foreground">{label}</p>
                <p className="text-sm font-semibold">{naira(value)}</p>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section
        title="Validation categories"
        description="Click a category to filter. CRITICAL issues must be resolved (recalculate) or overridden by Finance with a documented reason before approval."
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {CATS.map((c) => {
            const list = open.filter((i) => i.category === c);
            const cc = list.filter((i) => i.severity === "CRITICAL").length;
            const ww = list.filter((i) => i.severity === "WARNING").length;
            return (
              <Link
                key={c}
                href={`?cat=${c}`}
                className={`rounded-md border p-2 text-xs hover:bg-accent ${cat === c ? "ring-2 ring-ring" : ""} ${cc ? "border-red-300 bg-red-50" : ww ? "border-amber-200 bg-amber-50" : ""}`}
              >
                <p className="font-semibold">{c}</p>
                <p>
                  {cc ? (
                    <span className="text-red-700">{cc} critical</span>
                  ) : ww ? (
                    <span className="text-amber-700">{ww} warning</span>
                  ) : (
                    <span className="text-emerald-700">✓ OK</span>
                  )}
                </p>
              </Link>
            );
          })}
        </div>
      </Section>

      <Section
        title={`Validation results${cat ? ` — ${cat}` : ""}`}
        actions={
          <span className="flex gap-2 text-xs">
            <Link className="underline" href="?sev=CRITICAL">
              Critical
            </Link>
            <Link className="underline" href="?sev=WARNING">
              Warnings
            </Link>
            <Link className="underline" href="?">
              All
            </Link>
            <Link className="underline" href={`/reports/beat-reconciliation?runId=${run.id}`}>
              Beat reconciliation →
            </Link>
          </span>
        }
        flush
      >
        <Table>
          <THead>
            <TR>
              <TH>Severity</TH>
              <TH>Category</TH>
              <TH>Message</TH>
              <TH>Status</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {shown.map((i) => (
              <TR key={i.id} className={i.severity === "CRITICAL" && !i.overridden ? "bg-red-50/60" : ""}>
                <TD>
                  <StatusBadge status={i.severity} />
                </TD>
                <TD className="text-xs">{i.category}</TD>
                <TD className="whitespace-normal text-xs">
                  {i.message}
                  {i.employee && (
                    <>
                      {" "}
                      ·{" "}
                      <Link className="text-primary underline" href={`/employees/${i.employee.id}`}>
                        open
                      </Link>
                    </>
                  )}
                  {i.category === "LOCATION" && i.severity === "CRITICAL" && (
                    <>
                      {" "}
                      ·{" "}
                      <Link className="text-primary underline" href="/operations/work-register?exceptions=1">
                        resolve in work register
                      </Link>
                    </>
                  )}
                </TD>
                <TD className="text-xs">
                  {i.overridden ? (
                    <span title={i.overrideReason ?? ""}>
                      <Badge tone="violet">Overridden</Badge> by {i.overriddenBy}
                    </span>
                  ) : i.resolved ? (
                    <Badge tone="green">Resolved</Badge>
                  ) : (
                    <Badge>Open</Badge>
                  )}
                </TD>
                <TD>
                  {i.severity === "CRITICAL" &&
                    !i.overridden &&
                    can(ctx.role, "payroll.override") &&
                    ["CALCULATED", "PENDING_APPROVAL"].includes(run.status) && (
                      <ActionButton
                        action={overrideIssueAction.bind(null, i.id)}
                        reason
                        reasonPlaceholder="Documented reason (min 10 chars)"
                        variant="outline"
                      >
                        Finance override
                      </ActionButton>
                    )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!shown.length && <Empty>No validation results.</Empty>}
      </Section>

      <FilterBar>
        <FilterField label="Find employee">
          <Input name="q" defaultValue={sp.q} placeholder="EMP-000025" />
        </FilterField>
      </FilterBar>
      <Section
        title="Payroll records"
        description="Locations = distinct location ranges worked in the period (from the work register)."
        flush
      >
        <Table>
          <THead>
            <TR>
              <TH>Emp. No.</TH>
              <TH>Name</TH>
              <TH>Category</TH>
              <TH className="text-right">Days</TH>
              <TH>Locations</TH>
              <TH className="text-right">Earned gross</TH>
              <TH className="text-right">OT</TH>
              <TH className="text-right">Arrears/other</TH>
              <TH className="text-right">PAYE</TH>
              <TH className="text-right">Pension (EE)</TH>
              <TH className="text-right">Deductions</TH>
              <TH className="text-right">Net pay</TH>
              <TH className="text-right">Pension (ER)</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {records.map((r) => {
              const locs = r.locations as Array<{ beatName: string }>;
              return (
                <TR key={r.id}>
                  <TD className="font-mono text-xs">{r.employeeNumber}</TD>
                  <TD>
                    {r.employeeName}
                    {r.hasOverride && (
                      <Badge tone="violet" className="ml-1">
                        Override
                      </Badge>
                    )}
                  </TD>
                  <TD className="text-xs">{r.categoryName}</TD>
                  <TD className="text-right">
                    {num(r.daysWorked)}/{r.basisDays}
                  </TD>
                  <TD className="text-xs">
                    {locs.length > 1 ? (
                      <Badge tone="blue">{locs.length} ranges</Badge>
                    ) : (
                      (locs[0]?.beatName ?? "—")
                    )}
                  </TD>
                  <TD className="text-right">{naira(r.earnedGross)}</TD>
                  <TD className="text-right">{num(r.overtimeAmount) ? naira(r.overtimeAmount) : ""}</TD>
                  <TD className="text-right">
                    {num(r.arrearsAmount) + num(r.otherEarnings)
                      ? naira(num(r.arrearsAmount) + num(r.otherEarnings))
                      : ""}
                  </TD>
                  <TD className="text-right">{naira(r.paye)}</TD>
                  <TD className="text-right">{naira(r.employeePension)}</TD>
                  <TD className="text-right">{num(r.otherDeductions) ? naira(r.otherDeductions) : ""}</TD>
                  <TD className="text-right font-semibold">{naira(r.netPay)}</TD>
                  <TD className="text-right">{naira(r.employerPension)}</TD>
                  <TD>
                    <Link className="text-xs text-primary underline" href={`/payslips/${r.id}`}>
                      Payslip
                    </Link>
                  </TD>
                </TR>
              );
            })}
          </TBody>
          <TFoot>
            <TR>
              <TD colSpan={5}>Totals ({records.length})</TD>
              <TD className="text-right">{naira(sum("earnedGross"))}</TD>
              <TD className="text-right">{naira(sum("overtimeAmount"))}</TD>
              <TD className="text-right">{naira(sum("arrearsAmount") + sum("otherEarnings"))}</TD>
              <TD className="text-right">{naira(sum("paye"))}</TD>
              <TD className="text-right">{naira(sum("employeePension"))}</TD>
              <TD className="text-right">{naira(sum("otherDeductions"))}</TD>
              <TD className="text-right">{naira(sum("netPay"))}</TD>
              <TD className="text-right">{naira(sum("employerPension"))}</TD>
              <TD />
            </TR>
          </TFoot>
        </Table>
      </Section>
      <p className="text-xs text-muted-foreground">
        Period {fmtDate(run.period.startDate)} – {fmtDate(run.period.endDate)}. Approved by{" "}
        {run.period.approvedBy ?? "—"}; locked by {run.period.lockedBy ?? "—"}.
      </p>
    </>
  );
}
