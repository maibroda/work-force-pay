import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { exitTracker } from "@/server/services/hr-overview";
import { fmtDate } from "@/lib/dates";
import { fullName } from "@/lib/utils";
import { PageHeader, Section, Empty } from "@/components/page";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export default async function ExitsPage() {
  const ctx = await requirePage("hr.view");
  const rows = await exitTracker(ctx);
  return (
    <>
      <PageHeader
        title="Exits & clearance"
        description="Every resignation, termination and retirement: approval, clearance checklist, exit interview and the end-of-service settlement. Start an exit from the employee's record (Onboarding & exit tab)."
      />
      <Section title={`${rows.length} exit(s)`} flush>
        <Table>
          <THead>
            <TR>
              <TH>Employee</TH>
              <TH>Type</TH>
              <TH>Notice → last day</TH>
              <TH>Status</TH>
              <TH>Clearance</TH>
              <TH>Exit interview</TH>
              <TH>Settlement</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {rows.map((e) => (
              <TR key={e.id}>
                <TD>
                  <Link className="text-primary underline" href={`/employees/${e.employeeId}?tab=lifecycle`}>
                    {e.employee.employeeNumber} — {fullName(e.employee)}
                  </Link>
                </TD>
                <TD className="text-xs">
                  {e.exitType.replace(/_/g, " ").toLowerCase()}
                  {e.summaryDismissal && <span className="ml-1 text-red-700">(summary)</span>}
                </TD>
                <TD className="text-xs">
                  {fmtDate(e.noticeDate)} → {fmtDate(e.lastWorkingDate)}
                </TD>
                <TD>
                  <StatusBadge status={e.status} />
                </TD>
                <TD className="text-xs">
                  {e.status === "APPROVED" ? (
                    <span className={e.mandatoryOpen ? "text-amber-700" : "text-emerald-700"}>
                      {e.tasksDone}/{e.tasksTotal} done{e.mandatoryOpen ? ` · ${e.mandatoryOpen} required open` : ""}
                    </span>
                  ) : (
                    "—"
                  )}
                </TD>
                <TD className="text-xs">{e.exitInterviewDate ? fmtDate(e.exitInterviewDate) : "—"}</TD>
                <TD>
                  {e.settlement ? (
                    <Link href={`/payroll/settlements/${e.settlement.id}`}>
                      <StatusBadge status={e.settlement.status} />
                    </Link>
                  ) : e.status === "APPROVED" ? (
                    <span className="text-xs text-amber-700">not prepared</span>
                  ) : (
                    "—"
                  )}
                </TD>
                <TD>
                  <Link className="text-xs text-primary underline" href={`/hr/exits/${e.id}`}>
                    Open
                  </Link>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!rows.length && <Empty>No exits recorded.</Empty>}
      </Section>
    </>
  );
}
