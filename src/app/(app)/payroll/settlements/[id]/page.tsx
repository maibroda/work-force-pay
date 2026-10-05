import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { getSettlement } from "@/server/services/settlements";
import { options } from "@/server/options";
import { fmtDate } from "@/lib/dates";
import { naira, num } from "@/lib/money";
import { fullName } from "@/lib/utils";
import { FormPanel, KV, PageHeader, Section, Stat, StatGrid } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { SmartForm } from "@/components/smart-form";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TFoot, TH, THead, TR } from "@/components/ui/table";
import { addKitRecoveryAction } from "@/app/actions/inventory";
import { addLoanRecoveryAction } from "@/app/actions/loans";
import {
  addSettlementLineAction,
  approveSettlementAction,
  cancelSettlementAction,
  prepareSettlementAction,
  releaseSettlementAction,
  removeSettlementLineAction,
  returnSettlementAction,
  submitSettlementAction,
} from "@/app/actions/hr-lifecycle";

export default async function SettlementPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("payroll.view");
  const { id } = await params;
  const s = await getSettlement(ctx, id);
  if (!s) notFound();
  const o = await options(ctx);
  const prepare = can(ctx.role, "settlement.manage");
  const approve = can(ctx.role, "settlement.approve");
  const own = s.preparedById === ctx.userId;
  const trace = s.calcTrace as { notes?: string[]; payBasis?: { source: string } } | null;
  const earnings = s.lines.filter((l) => l.kind === "EARNING");
  const deductions = s.lines.filter((l) => l.kind === "DEDUCTION");
  const draft = s.status === "DRAFT";
  return (
    <>
      <PageHeader
        title={`${s.settlementNumber} — ${s.employee.employeeNumber} ${fullName(s.employee)}`}
        crumbs={[{ href: "/payroll/settlements", label: "Settlements" }]}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={s.status} /> {s.exitRecord.exitType.replace(/_/g, " ").toLowerCase()} · last working day {fmtDate(s.exitRecord.lastWorkingDate)}
            {s.exitRecord.summaryDismissal && <Badge tone="red">summary dismissal</Badge>}
            {s.paidThroughPayroll && <Badge tone="green">paid through payroll</Badge>}
          </span>
        }
        actions={
          <>
            {prepare && draft && (
              <ActionButton action={submitSettlementAction.bind(null, s.id)}>Submit for approval</ActionButton>
            )}
            {approve && s.status === "PENDING_APPROVAL" && !own && (
              <>
                <ActionButton action={approveSettlementAction.bind(null, s.id)} variant="success">
                  Approve
                </ActionButton>
                <ActionButton action={returnSettlementAction.bind(null, s.id)} reason reasonPlaceholder="What needs to change?" variant="outline">
                  Send back
                </ActionButton>
              </>
            )}
            {["DRAFT", "PENDING_APPROVAL", "APPROVED"].includes(s.status) && (prepare || approve) && (
              <ActionButton action={cancelSettlementAction.bind(null, s.id)} reason reasonPlaceholder="Why cancel?" variant="outline">
                Cancel
              </ActionButton>
            )}
          </>
        }
      />
      {s.status === "PENDING_APPROVAL" && own && (
        <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          You prepared this settlement, so someone else has to approve it.
        </p>
      )}
      {s.remarks && s.status === "DRAFT" && (
        <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">Sent back: {s.remarks}</p>
      )}
      {s.outstandingClearance.length > 0 && ["PENDING_APPROVAL", "DRAFT"].includes(s.status) && (
        <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Clearance still open — it must be finished before approval:{" "}
          {s.outstandingClearance.join("; ")}.{" "}
          <Link className="underline" href={`/hr/exits/${s.exitRecordId}`}>
            Open clearance checklist
          </Link>
        </p>
      )}

      <StatGrid cols={3}>
        <Stat label="Earnings" value={naira(s.grossEarnings)} tone="green" />
        <Stat label="Recoveries" value={naira(s.totalDeductions)} tone="amber" />
        <Stat label="Net settlement" value={naira(s.netSettlement)} tone={num(s.netSettlement) < 0 ? "red" : undefined} sub={num(s.netSettlement) < 0 ? "The leaver owes more than they're due — their final salary must cover it." : undefined} />
      </StatGrid>

      <Section title="How it was calculated">
        <KV
          cols={4}
          items={[
            ["Years of service", `${num(s.serviceYears)} (${s.serviceDays} days)`],
            ["Monthly gross used", naira(s.monthlyGross)],
            ["Monthly basic used", naira(s.monthlyBasic)],
            ["Daily rate", naira(s.dailyRate)],
            ["Pay reference", s.payBasisSource],
            ["Leave accrued / taken / payable", `${num(s.leaveAccruedDays)} / ${num(s.leaveTakenDays)} / ${num(s.leavePayableDays)} days`],
            ["Notice required / served", `${s.noticeRequiredDays} / ${s.noticeServedDays} days`],
            ["Notice shortfall", `${s.noticeShortfallDays} days`],
          ]}
        />
        {!!trace?.notes?.length && (
          <ul className="mt-4 list-disc space-y-1 border-t pt-3 pl-5 text-xs text-muted-foreground">
            {trace.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        )}
      </Section>

      {[
        { title: "Earnings", rows: earnings, total: s.grossEarnings },
        { title: "Recoveries", rows: deductions, total: s.totalDeductions },
      ].map((g) => (
        <Section key={g.title} title={g.title} flush>
          <Table>
            <THead>
              <TR>
                <TH>Line</TH>
                <TH className="text-right">Qty</TH>
                <TH className="text-right">Rate</TH>
                <TH className="text-right">Amount</TH>
                <TH>Taxable</TH>
                <TH>Source</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {g.rows.map((l) => (
                <TR key={l.id}>
                  <TD>
                    {l.description}
                    <div className="font-mono text-[10px] text-muted-foreground">{l.code}</div>
                  </TD>
                  <TD className="text-right text-xs">{l.quantity ? num(l.quantity) : "—"}</TD>
                  <TD className="text-right text-xs">{l.rate ? naira(l.rate) : "—"}</TD>
                  <TD className="text-right font-medium">{naira(l.amount)}</TD>
                  <TD className="text-xs">{l.kind === "EARNING" ? (l.taxable ? "Yes" : "No") : "—"}</TD>
                  <TD className="text-xs">{l.manual ? "Manual" : "Policy"}</TD>
                  <TD>
                    {prepare && draft && l.manual && (
                      <ActionButton action={removeSettlementLineAction.bind(null, l.id)} confirm="Remove this line?" variant="outline">
                        Remove
                      </ActionButton>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
            <TFoot>
              <TR className="font-semibold">
                <TD colSpan={3}>Total {g.title.toLowerCase()}</TD>
                <TD className="text-right">{naira(g.total)}</TD>
                <TD colSpan={3} />
              </TR>
            </TFoot>
          </Table>
          {!g.rows.length && <p className="px-4 py-4 text-center text-sm text-muted-foreground">None.</p>}
        </Section>
      ))}

      {prepare && draft && s.heldKit.items > 0 && (
        <p className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {s.employee.firstName} still holds {s.heldKit.items} item(s) of uniform &amp; kit worth {naira(s.heldKit.value)}.
          <ActionButton action={addKitRecoveryAction.bind(null, s.id)} variant="outline">
            Add as a recovery
          </ActionButton>
        </p>
      )}

      {prepare && draft && s.owingLoans.length > 0 && (
        <p className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {s.employee.firstName} still owes {naira(s.owingLoans.reduce((a, l) => a + l.unscheduled, 0))} on {s.owingLoans.length} staff loan(s)/advance(s) — {s.owingLoans.map((l) => l.loanNumber).join(", ")}.
          <ActionButton action={addLoanRecoveryAction.bind(null, s.id)} variant="outline">
            Recover the loan balance
          </ActionButton>
        </p>
      )}

      {prepare && draft && (
        <div className="grid gap-5 lg:grid-cols-2">
          <FormPanel title="Add a manual line">
            <p className="mb-3 text-xs text-muted-foreground">
              Staff loan balance, unreturned property, an ex-gratia payment — anything the policy can&apos;t know about.
            </p>
            <SmartForm
              columns={2}
              submitLabel="Add line"
              action={addSettlementLineAction.bind(null, s.id)}
              fields={[
                { name: "kind", label: "Type", type: "select", required: true, defaultValue: "DEDUCTION", options: [{ value: "DEDUCTION", label: "Recovery (deduct)" }, { value: "EARNING", label: "Payment (earning)" }] },
                { name: "code", label: "Code", help: "Recoveries: loan, salary_advance, recovery, penalty, other. Payments: any (default ex_gratia)." },
                { name: "description", label: "Description", required: true, span: 2 },
                { name: "amount", label: "Amount (₦)", type: "number", required: true, min: 0.01 },
                { name: "taxable", label: "Taxable (payments only)", type: "checkbox", defaultValue: true },
              ]}
            />
          </FormPanel>
          <FormPanel title="Recalculate">
            <p className="mb-3 text-xs text-muted-foreground">
              Rebuilds the policy lines (manual lines are kept) — use it after changing the HR policy or the exit details, or to override the pay figures.
            </p>
            <SmartForm
              columns={2}
              submitLabel="Recalculate"
              resetOnSuccess={false}
              action={prepareSettlementAction.bind(null, s.exitRecordId)}
              fields={[
                { name: "monthlyGrossOverride", label: "Monthly gross (₦)", type: "number", min: 1 },
                { name: "monthlyBasicOverride", label: "Monthly basic (₦)", type: "number", min: 1 },
              ]}
            />
          </FormPanel>
        </div>
      )}

      {approve && s.status === "APPROVED" && (
        <Section
          title="Release into payroll"
          description="Creates approved earnings and deductions in the payroll period that contains the last working day. PAYE, pension, the payslip, payment and GL posting then happen in the normal payroll run."
        >
          <SmartForm
            columns={2}
            submitLabel="Release into payroll"
            resetOnSuccess={false}
            action={releaseSettlementAction.bind(null, s.id)}
            fields={[
              {
                name: "periodId",
                label: "Payroll period",
                type: "select",
                required: true,
                defaultValue: s.suggestedPeriod?.id ?? "",
                options: o.periods,
                help: s.suggestedPeriod
                  ? `The last working day falls in ${s.suggestedPeriod.name} (${s.suggestedPeriod.status.toLowerCase()}).`
                  : "No payroll period contains the last working day — create one first.",
              },
            ]}
          />
        </Section>
      )}

      {s.status === "RELEASED" && (
        <Section title="Released">
          <p className="text-sm">
            Released into <b>{s.payrollPeriod?.name}</b> by {s.releasedBy} on {fmtDate(s.releasedAt)}.{" "}
            {s.paidThroughPayroll
              ? "The payroll has been locked, so these amounts are paid."
              : s.payrollPeriod && ["LOCKED", "PAID", "CLOSED"].includes(s.payrollPeriod.status)
                ? "That payroll is locked — create a supplementary run to pay these amounts."
                : "Recalculate that payroll so the lines appear on the payslip."}{" "}
            <Link className="text-primary underline" href="/payroll/supplementary">
              Supplementary payroll
            </Link>{" "}
            ·{" "}
            <Link className="text-primary underline" href="/payroll/runs">
              Payroll runs
            </Link>
          </p>
        </Section>
      )}
    </>
  );
}
