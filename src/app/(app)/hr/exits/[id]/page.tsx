import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { getExitDetail } from "@/server/services/hr-overview";
import { fmtDate } from "@/lib/dates";
import { naira } from "@/lib/money";
import { fullName } from "@/lib/utils";
import { FormPanel, KV, PageHeader, Section, Empty } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { SmartForm } from "@/components/smart-form";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { approveExitAction, completeExitTaskAction, rejectExitAction } from "@/app/actions/hr";
import { prepareSettlementAction, recordExitInterviewAction, waiveTaskAction } from "@/app/actions/hr-lifecycle";
import { generateLetterAction } from "@/app/actions/letters";

const REASONS = [
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
];

export default async function ExitPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("hr.view");
  const { id } = await params;
  const x = await getExitDetail(ctx, id);
  if (!x) notFound();
  const manage = can(ctx.role, "hr.manage");
  const approve = can(ctx.role, "hr.approve");
  const prepare = can(ctx.role, "settlement.manage");
  const today = new Date();
  return (
    <>
      <PageHeader
        title={`Exit — ${x.employee.employeeNumber} ${fullName(x.employee)}`}
        crumbs={[{ href: "/hr/exits", label: "Exits & clearance" }]}
        description={
          <span className="flex items-center gap-2">
            <StatusBadge status={x.status} /> {x.exitType.replace(/_/g, " ").toLowerCase()}
            {x.summaryDismissal && <Badge tone="red">summary dismissal</Badge>}
          </span>
        }
        actions={
          approve && x.status === "PENDING" ? (
            <>
              <ActionButton action={approveExitAction.bind(null, x.id)} variant="success">
                Approve exit
              </ActionButton>
              <ActionButton action={rejectExitAction.bind(null, x.id)} reason reasonPlaceholder="Reason for rejecting" variant="outline">
                Reject
              </ActionButton>
            </>
          ) : undefined
        }
      />

      <Section title="Exit">
        <KV
          cols={4}
          items={[
            ["Employee", <Link key="e" className="text-primary underline" href={`/employees/${x.employeeId}`}>{x.employee.employeeNumber} — {fullName(x.employee)}</Link>],
            ["Category", x.employee.category.name],
            ["Joined", fmtDate(x.employee.employmentDate)],
            ["Initiated by", x.initiatedBy],
            ["Notice given", fmtDate(x.noticeDate)],
            ["Last working day", fmtDate(x.lastWorkingDate)],
            ["Notice required", x.noticePeriodDays === null ? "—" : `${x.noticePeriodDays} days`],
            ["Reason category", x.reasonCategory?.replace(/_/g, " ").toLowerCase()],
            ["Reason", x.reason],
            ["Decision", x.approvedBy ? `${x.approvedBy}${x.remarks ? ` — ${x.remarks}` : ""}` : "—"],
            ["Eligible for rehire", x.eligibleForRehire === null ? "Not recorded" : x.eligibleForRehire ? "Yes" : <span key="r" className="font-medium text-red-700">No</span>],
            ["Exit interview", x.exitInterviewDate ? `${fmtDate(x.exitInterviewDate)} (${x.exitInterviewBy})` : "Not held yet"],
          ]}
        />
        {x.exitInterviewNotes && (
          <p className="mt-3 whitespace-pre-line border-t pt-3 text-sm">
            <span className="text-xs font-medium uppercase text-muted-foreground">Exit interview notes</span>
            <br />
            {x.exitInterviewNotes}
          </p>
        )}
      </Section>

      {x.status === "APPROVED" && (
        <Section
          title="Clearance checklist"
          description="Required steps marked ‘blocks settlement’ must be done (or waived with a reason) before the settlement can be approved."
          flush
        >
          <Table>
            <THead>
              <TR>
                <TH>Step</TH>
                <TH>Responsible</TH>
                <TH>Due</TH>
                <TH>Status</TH>
                <TH>Done by</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {x.tasks.map((t) => {
                const late = t.status === "PENDING" && t.dueDate && t.dueDate < today;
                return (
                  <TR key={t.id}>
                    <TD>
                      {t.taskName}
                      {!t.mandatory && <span className="ml-2 text-[11px] text-muted-foreground">(optional)</span>}
                      {t.blocksSettlement && t.mandatory && <span className="ml-2 text-[11px] text-amber-700">blocks settlement</span>}
                    </TD>
                    <TD className="text-xs">{t.responsibleRole ?? "—"}</TD>
                    <TD className={late ? "text-xs font-medium text-red-700" : "text-xs"}>{t.dueDate ? fmtDate(t.dueDate) : "—"}</TD>
                    <TD>
                      <StatusBadge status={t.status} />
                    </TD>
                    <TD className="text-xs">
                      {t.completedBy ?? "—"}
                      {t.notes && <div className="text-muted-foreground">{t.notes}</div>}
                    </TD>
                    <TD>
                      {manage && t.status === "PENDING" && (
                        <div className="flex gap-1">
                          <ActionButton action={completeExitTaskAction.bind(null, t.id)} variant="success">
                            Done
                          </ActionButton>
                          <ActionButton action={waiveTaskAction.bind(null, "exit", t.id)} reason reasonPlaceholder="Why doesn't it apply?" variant="outline">
                            N/A
                          </ActionButton>
                        </div>
                      )}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
          {!x.tasks.length && <Empty>No checklist steps — the exit checklist template is empty.</Empty>}
        </Section>
      )}

      {x.employee.assignedFixedAssets.length > 0 && (
        <Section
          title={`Company assets still assigned (${x.employee.assignedFixedAssets.length})`}
          description="From the Fixed Asset Register — these should be returned (or written off) before clearance is signed off."
          flush
        >
          <Table>
            <THead>
              <TR>
                <TH>Asset</TH>
                <TH>Name</TH>
                <TH>Category</TH>
                <TH className="text-right">Cost</TH>
              </TR>
            </THead>
            <TBody>
              {x.employee.assignedFixedAssets.map((a) => (
                <TR key={a.id}>
                  <TD className="font-mono text-xs">
                    <Link className="text-primary underline" href={`/finance/fixed-assets/${a.id}`}>
                      {a.assetNumber}
                    </Link>
                  </TD>
                  <TD>{a.name}</TD>
                  <TD className="text-xs">{a.category.replace(/_/g, " ").toLowerCase()}</TD>
                  <TD className="text-right">{naira(a.cost)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Section>
      )}

      {x.kit && x.kit.items > 0 && (
        <Section
          title={`Uniform & kit still held (${x.kit.items} item(s), ${naira(x.kit.value)})`}
          description="Take it back, or recover its value through the settlement."
          actions={
            <Link className="text-xs text-primary underline" href={`/employees/${x.employeeId}?tab=kit`}>
              Manage kit
            </Link>
          }
          flush
        >
          <Table>
            <THead>
              <TR>
                <TH>Item</TH>
                <TH className="text-right">Held</TH>
                <TH className="text-right">Value</TH>
              </TR>
            </THead>
            <TBody>
              {x.kit.rows.map((r) => (
                <TR key={r.item.id}>
                  <TD>
                    {r.item.name}
                    {r.item.size ? ` — ${r.item.size}` : ""}
                  </TD>
                  <TD className="text-right">{r.outstanding}</TD>
                  <TD className="text-right">{naira(r.value)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Section>
      )}

      {x.loans.length > 0 && (
        <Section
          title={`Staff loans & advances still owed (${naira(x.loans.reduce((s, l) => s + l.outstanding, 0))})`}
          description="Recover the part not already queued in payroll through the settlement."
          flush
        >
          <Table>
            <THead>
              <TR>
                <TH>Loan</TH>
                <TH className="text-right">Outstanding</TH>
                <TH className="text-right">Already queued in payroll</TH>
                <TH className="text-right">To recover</TH>
              </TR>
            </THead>
            <TBody>
              {x.loans.map((l) => (
                <TR key={l.id}>
                  <TD className="font-mono text-xs">
                    <Link className="text-primary underline" href={`/payroll/loans/${l.id}`}>
                      {l.loanNumber}
                    </Link>{" "}
                    <span className="text-muted-foreground">{l.type === "SALARY_ADVANCE" ? "advance" : "loan"}</span>
                  </TD>
                  <TD className="text-right">{naira(l.outstanding)}</TD>
                  <TD className="text-right">{naira(l.scheduled)}</TD>
                  <TD className="text-right font-medium">{naira(l.unscheduled)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Section>
      )}

      {manage && x.status !== "REJECTED" && (
        <FormPanel title={x.exitInterviewDate ? "Update the exit interview" : "Record the exit interview"}>
          <SmartForm
            columns={3}
            submitLabel="Save exit interview"
            resetOnSuccess={false}
            action={recordExitInterviewAction}
            fields={[
              { name: "exitRecordId", label: "", type: "hidden", defaultValue: x.id },
              { name: "interviewDate", label: "Interview date", type: "date", required: true, defaultValue: x.exitInterviewDate?.toISOString().slice(0, 10) },
              { name: "reasonCategory", label: "Why are they leaving?", type: "select", defaultValue: x.reasonCategory ?? "", options: REASONS.map((r) => ({ value: r, label: r.replace(/_/g, " ").toLowerCase() })) },
              { name: "eligibleForRehire", label: "Eligible for rehire", type: "checkbox", defaultValue: x.eligibleForRehire ?? true },
              { name: "notes", label: "What was discussed", type: "textarea", required: true, span: 3, defaultValue: x.exitInterviewNotes ?? "" },
            ]}
          />
        </FormPanel>
      )}

      {manage && x.status === "APPROVED" && (
        <Section title="Letters" description="The clearance certificate is only available once every required clearance step is done.">
          <div className="flex flex-wrap gap-2">
            <ActionButton action={generateLetterAction.bind(null, { type: "EXIT_LETTER", exitRecordId: x.id })} variant="outline">
              Exit letter
            </ActionButton>
            <ActionButton action={generateLetterAction.bind(null, { type: "CLEARANCE_CERTIFICATE", exitRecordId: x.id })} variant="outline">
              Clearance certificate
            </ActionButton>
            <ActionButton action={generateLetterAction.bind(null, { type: "EXPERIENCE", employeeId: x.employeeId })} variant="outline">
              Experience letter
            </ActionButton>
          </div>
        </Section>
      )}

      <Section title="End-of-service settlement" description="What the leaver is owed on top of their final month's pay — unused leave, gratuity, severance, notice pay or recovery.">
        {x.settlement ? (
          <p className="text-sm">
            {x.settlement.settlementNumber} is <StatusBadge status={x.settlement.status} />.{" "}
            <Link className="text-primary underline" href={`/payroll/settlements/${x.settlement.id}`}>
              Open the settlement
            </Link>
          </p>
        ) : x.status !== "APPROVED" ? (
          <p className="text-sm text-muted-foreground">Approve the exit first — the settlement is prepared once the leaving date is confirmed.</p>
        ) : prepare ? (
          <SmartForm
            columns={3}
            submitLabel="Calculate settlement"
            action={prepareSettlementAction.bind(null, x.id)}
            fields={[
              { name: "monthlyGrossOverride", label: "Monthly gross (₦) — only if payroll has none", type: "number", min: 1, help: "Blank = taken from the latest payroll, else the personal pay rate." },
              { name: "monthlyBasicOverride", label: "Monthly basic (₦) — optional", type: "number", min: 1 },
            ]}
          />
        ) : (
          <p className="text-sm text-muted-foreground">Payroll or HR prepares the settlement.</p>
        )}
      </Section>
    </>
  );
}
