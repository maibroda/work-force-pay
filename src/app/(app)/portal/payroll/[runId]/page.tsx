import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { BusinessError } from "@/server/services/_base";
import { portalRun } from "@/server/services/portal";
import { fmtDate } from "@/lib/dates";
import { naira, num } from "@/lib/money";
import { ActionButton } from "@/components/action-button";
import { KV, PageHeader, Section } from "@/components/page";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TFoot, TH, THead, TR } from "@/components/ui/table";
import { clientApproveAction, clientRejectAction } from "@/app/actions/portal";

export default async function PortalPayrollPage({ params }: { params: Promise<{ runId: string }> }) {
  const ctx = await requirePage("portal.view");
  const { runId } = await params;
  const p = await portalRun(ctx, runId).catch((e) => {
    if (e instanceof BusinessError) return null;
    throw e;
  });
  if (!p) notFound();
  const { run, records, reconciliation: r, explained, history, approval } = p;
  const canDecide = can(ctx.role, "portal.approve") && approval.awaiting;
  const sum = (k: "totalEarnings" | "paye" | "employeePension" | "totalDeductions" | "netPay") => records.reduce((a, x) => a + num(x[k]), 0);

  return (
    <>
      <PageHeader
        title={`Payroll — ${run.period.name}`}
        crumbs={[{ href: "/portal", label: "Your payroll" }]}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={run.status} /> {run.employeeCount} employees · pay period {fmtDate(run.period.startDate)} to {fmtDate(run.period.endDate)}
          </span>
        }
        actions={
          canDecide && (
            <>
              <ActionButton action={clientApproveAction.bind(null, run.id)} reason reasonPlaceholder="A note (optional)" variant="success">
                Approve this payroll
              </ActionButton>
              <ActionButton action={clientRejectAction.bind(null, run.id)} reason reasonPlaceholder="What needs to change?" variant="outline">
                Send back
              </ActionButton>
            </>
          )
        }
      />

      {["APPROVED", "LOCKED", "PAID"].includes(run.status) && can(ctx.role, "portal.download") && (
        <p className="flex flex-wrap gap-4 text-sm">
          <a className="text-primary underline" href={`/api/portal/runs/${run.id}/register`}>
            Download the payroll register (CSV)
          </a>
          <a className="text-primary underline" href={`/api/portal/runs/${run.id}/payslips`}>
            Download all payslips (zip of PDFs)
          </a>
        </p>
      )}
      {approval.awaiting && <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-900">This payroll is waiting for your approval. Check the figures below. Once you approve, the bureau can lock it and prepare the payments.</p>}
      {approval.approvedNow && approval.last && (
        <p className="rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          Approved by {approval.last.byName} on {fmtDate(approval.last.createdAt)}.
          {approval.last.comment ? ` Note: ${approval.last.comment}` : ""}
        </p>
      )}

      <Section title="Totals">
        <KV
          cols={3}
          items={[
            ["Employees", String(run.employeeCount)],
            ["Gross pay", naira(run.totalGross)],
            ["PAYE (tax)", naira(run.totalPaye)],
            ["Employee pension", naira(run.totalEmployeePension)],
            ["Employer pension", naira(run.totalEmployerPension)],
            ["Net pay to employees", <b key="n">{naira(run.totalNet)}</b>],
          ]}
        />
      </Section>

      {r && r.bridge.hasPrior && (
        <Section title={`Compared with ${r.prior?.periodName}`} description="What changed since the last payroll.">
          <KV
            cols={3}
            items={[
              ["Headcount", `${r.bridge.priorHeadcount} → ${r.bridge.currentHeadcount}`],
              ["Joined", r.bridge.joiners.length ? r.bridge.joiners.map((x) => x.label).join(", ") : "—"],
              ["Left", r.bridge.leavers.length ? r.bridge.leavers.map((x) => x.label).join(", ") : "—"],
              ["Net pay last time", naira(r.bridge.net.prior)],
              ["Net pay now", naira(r.bridge.net.current)],
              ["Change for continuing staff", naira(r.bridge.net.continuing)],
            ]}
          />
        </Section>
      )}

      {explained.length > 0 && (
        <Section title="Changes we had to explain" description="Where an employee's pay or the headcount moved a lot, with the reason recorded by the bureau.">
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {explained.map((x, i) => (
              <li key={i}>
                {x.message} <span className="text-muted-foreground">— {x.explanation ?? "no explanation recorded"}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Employees" flush>
        <Table>
          <THead>
            <TR>
              <TH>No.</TH>
              <TH>Name</TH>
              <TH>Department</TH>
              <TH className="text-right">Days</TH>
              <TH className="text-right">Gross</TH>
              <TH className="text-right">PAYE</TH>
              <TH className="text-right">Pension</TH>
              <TH className="text-right">Net pay</TH>
            </TR>
          </THead>
          <TBody>
            {records.map((x) => (
              <TR key={x.id}>
                <TD className="font-mono text-xs">{x.employeeNumber}</TD>
                <TD>{x.employeeName}</TD>
                <TD className="text-xs">{x.departmentName ?? "—"}</TD>
                <TD className="text-right text-xs">
                  {num(x.daysWorked)}/{x.basisDays}
                </TD>
                <TD className="text-right">{naira(x.totalEarnings)}</TD>
                <TD className="text-right">{naira(x.paye)}</TD>
                <TD className="text-right">{naira(x.employeePension)}</TD>
                <TD className="text-right font-medium">{naira(x.netPay)}</TD>
              </TR>
            ))}
          </TBody>
          <TFoot>
            <TR>
              <TD colSpan={4}>Totals ({records.length})</TD>
              <TD className="text-right">{naira(sum("totalEarnings"))}</TD>
              <TD className="text-right">{naira(sum("paye"))}</TD>
              <TD className="text-right">{naira(sum("employeePension"))}</TD>
              <TD className="text-right">{naira(sum("netPay"))}</TD>
            </TR>
          </TFoot>
        </Table>
      </Section>

      {history.length > 0 && (
        <Section title="Decisions" flush>
          <Table>
            <THead>
              <TR>
                <TH>When</TH>
                <TH>By</TH>
                <TH>Decision</TH>
                <TH>Note</TH>
              </TR>
            </THead>
            <TBody>
              {history.map((h) => (
                <TR key={h.id}>
                  <TD>{fmtDate(h.createdAt)}</TD>
                  <TD className="text-xs">{h.byName}</TD>
                  <TD>{h.decision === "APPROVED" ? <Badge tone="green">Approved</Badge> : <Badge tone="red">Sent back</Badge>}</TD>
                  <TD className="whitespace-normal text-xs">{h.comment ?? "—"}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Section>
      )}
    </>
  );
}
