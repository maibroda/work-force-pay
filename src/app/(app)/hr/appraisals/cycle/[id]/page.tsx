import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { getCycle } from "@/server/services/appraisals";
import { KIND_LABELS } from "@/lib/appraisal";
import { fmtDate } from "@/lib/dates";
import { num } from "@/lib/money";
import { fullName } from "@/lib/utils";
import { PageHeader, Section, Stat, StatGrid } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { closeCycleAction } from "@/app/actions/appraisals";

export default async function CyclePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("appraisal.view");
  const { id } = await params;
  const data = await getCycle(ctx, id);
  if (!data) notFound();
  const { cycle, appraisals, average, bands, unassigned } = data;
  const done = appraisals.filter((a) => a.status === "APPROVED" || a.status === "ACKNOWLEDGED").length;
  const disputed = appraisals.filter((a) => a.employeeAgreed === false).length;
  return (
    <>
      <PageHeader
        title={cycle.name}
        crumbs={[{ href: "/hr/appraisals", label: "Appraisals" }]}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={cycle.status} /> {KIND_LABELS[cycle.kind]} · {fmtDate(cycle.periodStart)} – {fmtDate(cycle.periodEnd)} · due {fmtDate(cycle.dueDate)}
          </span>
        }
        actions={
          can(ctx.role, "appraisal.manage") && cycle.status === "OPEN" ? (
            <ActionButton action={closeCycleAction.bind(null, cycle.id)} confirm="Close this cycle? Unfinished appraisals can no longer be completed." variant="outline">
              Close cycle
            </ActionButton>
          ) : undefined
        }
      />
      <StatGrid cols={4}>
        <Stat label="Appraisals" value={appraisals.length} />
        <Stat label="Signed off" value={`${done}/${appraisals.length}`} tone={done === appraisals.length && done > 0 ? "green" : undefined} />
        <Stat label="Average score" value={average != null ? average.toFixed(2) : "—"} />
        <Stat label="No reviewer assigned" value={unassigned} tone={unassigned ? "amber" : "green"} sub={disputed ? `${disputed} disputed by the employee` : undefined} />
      </StatGrid>
      {bands.length > 0 && (
        <p className="mb-4 flex flex-wrap gap-2 text-sm">
          {bands.map((b) => (
            <Badge key={b.band} tone="blue">
              {b.band}: {b.count}
            </Badge>
          ))}
        </p>
      )}
      <Section title="Appraisals" flush>
        <Table>
          <THead>
            <TR>
              <TH>Employee</TH>
              <TH>Category</TH>
              <TH>Reviewer</TH>
              <TH>Self</TH>
              <TH>Status</TH>
              <TH>Score</TH>
            </TR>
          </THead>
          <TBody>
            {appraisals.map((a) => (
              <TR key={a.id}>
                <TD>
                  <Link className="text-primary hover:underline" href={`/hr/appraisals/${a.id}`}>
                    {a.employee.employeeNumber} {fullName(a.employee)}
                  </Link>
                </TD>
                <TD className="text-xs">{a.employee.category.name}</TD>
                <TD className="text-xs">{a.reviewerName ?? <Badge tone="amber">not assigned</Badge>}</TD>
                <TD className="text-xs">{a.selfSubmittedAt ? "done" : "—"}</TD>
                <TD>
                  <StatusBadge status={a.status} />
                  {a.employeeAgreed === false && <Badge tone="red">disputed</Badge>}
                </TD>
                <TD className="text-xs">{a.overallScore != null ? `${num(a.overallScore).toFixed(2)} — ${a.overallBand}` : "—"}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Section>
    </>
  );
}
