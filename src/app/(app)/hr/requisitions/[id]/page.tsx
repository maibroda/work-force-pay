import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { getRequisition } from "@/server/services/recruitment";
import { fmtDate } from "@/lib/dates";
import { naira } from "@/lib/money";
import { fullName } from "@/lib/utils";
import { FormPanel, KV, PageHeader, Section, Empty } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { SmartForm } from "@/components/smart-form";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import {
  addCandidateAction,
  approveRequisitionAction,
  closeRequisitionAction,
  holdRequisitionAction,
  rejectRequisitionAction,
} from "@/app/actions/hr-lifecycle";

const SOURCES = ["REFERRAL", "JOB_BOARD", "WALK_IN", "AGENCY", "INTERNAL", "SOCIAL_MEDIA", "OTHER"];

export default async function RequisitionPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("hr.view");
  const { id } = await params;
  const r = await getRequisition(ctx, id);
  if (!r) notFound();
  const manage = can(ctx.role, "hr.manage");
  const approve = can(ctx.role, "hr.approve");
  const hired = r.candidates.filter((c) => c.stage === "HIRED").length;
  const ownRequest = r.requestedById === ctx.userId;
  return (
    <>
      <PageHeader
        title={`${r.requisitionNumber} — ${r.title}`}
        crumbs={[{ href: "/hr/requisitions", label: "Requisitions" }]}
        description={
          <span className="flex items-center gap-2">
            <StatusBadge status={r.status} /> {hired} of {r.headcount} position(s) filled
          </span>
        }
        actions={
          <>
            {approve && r.status === "PENDING_APPROVAL" && !ownRequest && (
              <>
                <ActionButton action={approveRequisitionAction.bind(null, r.id)} variant="success">
                  Approve
                </ActionButton>
                <ActionButton action={rejectRequisitionAction.bind(null, r.id)} reason reasonPlaceholder="Reason for rejecting" variant="outline">
                  Reject
                </ActionButton>
              </>
            )}
            {manage && r.status === "APPROVED" && (
              <ActionButton action={holdRequisitionAction.bind(null, r.id, true)} variant="outline">
                Put on hold
              </ActionButton>
            )}
            {manage && r.status === "ON_HOLD" && (
              <ActionButton action={holdRequisitionAction.bind(null, r.id, false)} variant="outline">
                Resume
              </ActionButton>
            )}
            {manage && ["APPROVED", "ON_HOLD", "PENDING_APPROVAL"].includes(r.status) && (
              <ActionButton action={closeRequisitionAction.bind(null, r.id)} reason reasonPlaceholder="Why is it being closed?" variant="outline">
                Close
              </ActionButton>
            )}
          </>
        }
      />
      {r.status === "PENDING_APPROVAL" && ownRequest && (
        <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          You raised this requisition, so someone else has to approve it.
        </p>
      )}
      <Section title="Details">
        <KV
          cols={4}
          items={[
            ["Category", r.category.name],
            ["Department", r.department?.name],
            ["Cost center", r.costCenter ? `${r.costCenter.code} — ${r.costCenter.name}` : "—"],
            ["Hiring manager", r.hiringManager ? `${r.hiringManager.employeeNumber} — ${fullName(r.hiringManager)}` : "—"],
            ["Positions", r.headcount],
            ["Employment type", r.employmentType.replace(/_/g, " ")],
            ["Budgeted monthly gross", r.budgetedMonthlyGross ? naira(r.budgetedMonthlyGross) : "—"],
            ["Target start", fmtDate(r.targetStartDate)],
            ["Raised by", `${r.requestedBy} · ${fmtDate(r.createdAt)}`],
            ["Decision", r.approvedBy ? `${r.approvedBy} · ${fmtDate(r.approvedAt)}` : "—"],
            ["Decision note", r.decisionNote],
            ["Justification", r.justification],
          ]}
        />
      </Section>

      <Section title={`Candidates (${r.candidates.length})`} flush>
        <Table>
          <THead>
            <TR>
              <TH>Candidate</TH>
              <TH>Name</TH>
              <TH>Source</TH>
              <TH>Interviews</TH>
              <TH>Vetting</TH>
              <TH>Stage</TH>
            </TR>
          </THead>
          <TBody>
            {r.candidates.map((c) => (
              <TR key={c.id}>
                <TD className="font-mono text-xs">
                  <Link className="text-primary underline" href={`/hr/candidates/${c.id}`}>
                    {c.candidateNumber}
                  </Link>
                </TD>
                <TD>
                  {c.firstName} {c.lastName}
                </TD>
                <TD className="text-xs">{c.source.replace(/_/g, " ")}</TD>
                <TD className="text-xs">
                  {c.interviews.filter((i) => i.completedAt).length}/{c.interviews.length} done
                </TD>
                <TD className="text-xs">
                  {c.checks.length ? `${c.checks.filter((k) => k.status === "CLEARED" || k.status === "WAIVED").length}/${c.checks.length} cleared` : "—"}
                </TD>
                <TD>
                  <StatusBadge status={c.stage} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!r.candidates.length && <Empty>No candidates yet.</Empty>}
      </Section>

      {manage && r.status === "APPROVED" && (
        <FormPanel title="Add a candidate">
          <SmartForm
            columns={3}
            submitLabel="Add candidate"
            action={addCandidateAction}
            fields={[
              { name: "requisitionId", label: "", type: "hidden", defaultValue: r.id },
              { name: "firstName", label: "First name", required: true },
              { name: "lastName", label: "Last name", required: true },
              { name: "phone", label: "Phone" },
              { name: "email", label: "Email", type: "email" },
              { name: "source", label: "Source", type: "select", defaultValue: "OTHER", options: SOURCES.map((s) => ({ value: s, label: s.replace(/_/g, " ") })) },
              { name: "expectedMonthlyGross", label: "Expected monthly gross (₦)", type: "number", min: 1 },
              { name: "resumeReference", label: "CV / application reference", span: 3 },
              { name: "notes", label: "Notes", type: "textarea", span: 3 },
            ]}
          />
        </FormPanel>
      )}
    </>
  );
}
