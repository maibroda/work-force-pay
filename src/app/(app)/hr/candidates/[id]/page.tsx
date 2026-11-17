import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { getCandidate } from "@/server/services/recruitment";
import { eligiblePanelists, panelOverview } from "@/server/services/recruitment-panel";
import { candidateScreening } from "@/server/services/recruitment-screening";
import { enumOptions } from "@/server/options";
import { fmtDate } from "@/lib/dates";
import { naira } from "@/lib/money";
import { FormPanel, KV, PageHeader, Section, Empty } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { SmartForm } from "@/components/smart-form";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { generateLetterAction } from "@/app/actions/letters";
import { decideShortlistAction, recordScreeningAction } from "@/app/actions/recruitment-screening";
import { approveSelectionAction, closePanelAction, declineSelectionAction, setPanelAction } from "@/app/actions/recruitment-panel";
import {
  addCheckAction,
  addStandardChecksAction,
  approveOfferAction,
  createOfferAction,
  hireCandidateAction,
  interviewFeedbackAction,
  markOfferSentAction,
  moveCandidateAction,
  offerResponseAction,
  rejectOfferAction,
  scheduleInterviewAction,
  updateCheckAction,
  withdrawOfferAction,
} from "@/app/actions/hr-lifecycle";

const OPEN = ["APPLIED", "SCREENING", "INTERVIEW", "ASSESSMENT", "OFFER"];
const MOVES = ["SCREENING", "INTERVIEW", "ASSESSMENT", "OFFER"];
const TYPES = ["PERMANENT", "FIXED_TERM", "PROBATION", "CASUAL", "CONSULTANT", "INTERNSHIP"];
const CHECKS = ["REFERENCE", "ID_VERIFICATION", "POLICE_CLEARANCE", "GUARANTOR", "MEDICAL", "EDUCATION", "CREDIT", "OTHER"];

export default async function CandidatePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("hr.view");
  const { id } = await params;
  const c = await getCandidate(ctx, id);
  if (!c) notFound();
  const manage = can(ctx.role, "hr.manage");
  const approve = can(ctx.role, "hr.approve");
  // interview panels and the selection are read and set up by HR (recruitment.assess) alone; everyone else sees that interviews took place, not what was said
  const assess = can(ctx.role, "recruitment.assess");
  const panels = assess ? await panelOverview(ctx, id) : null;
  const staff = assess ? await eligiblePanelists(ctx) : [];
  const screen = assess ? await candidateScreening(ctx, id) : null;
  const panelled = new Set((panels?.interviews ?? []).filter((p) => p.members.length > 0).map((p) => p.interviewId));
  const open = OPEN.includes(c.stage);
  const liveOffer = c.offers.find((o) => ["PENDING_APPROVAL", "APPROVED", "SENT"].includes(o.status));
  const accepted = c.offers.find((o) => o.status === "ACCEPTED");
  return (
    <>
      <PageHeader
        title={`${c.candidateNumber} — ${c.firstName} ${c.lastName}`}
        crumbs={[
          { href: "/hr/candidates", label: "Candidates" },
          { href: `/hr/requisitions/${c.requisitionId}`, label: c.requisition.requisitionNumber },
        ]}
        description={
          <span className="flex items-center gap-2">
            <StatusBadge status={c.stage} /> {c.requisition.title}
            {c.employee && (
              <Link className="text-primary underline" href={`/employees/${c.employee.id}`}>
                {c.employee.employeeNumber}
              </Link>
            )}
          </span>
        }
        actions={
          manage && open ? (
            <>
              <ActionButton action={moveCandidateAction.bind(null, c.id, "WITHDRAWN")} reason reasonPlaceholder="Why did they withdraw?" variant="outline">
                Withdrew
              </ActionButton>
              <ActionButton action={moveCandidateAction.bind(null, c.id, "REJECTED")} reason reasonPlaceholder="Reason for rejecting" variant="outline">
                Reject
              </ActionButton>
            </>
          ) : undefined
        }
      />

      <Section title="Candidate">
        <KV
          cols={4}
          items={[
            ["Phone", c.phone],
            ["Email", c.email],
            ["Source", c.source.replace(/_/g, " ")],
            ["Expected monthly gross", c.expectedMonthlyGross ? naira(c.expectedMonthlyGross) : "—"],
            ["CV / reference", c.resumeReference],
            ["Added by", `${c.createdBy} · ${fmtDate(c.createdAt)}`],
            ["Rejection / withdrawal reason", c.rejectionReason],
            ["Notes", c.notes],
          ]}
        />
        {manage && open && (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-3">
            <span className="text-xs text-muted-foreground">Move to stage:</span>
            {MOVES.filter((s) => s !== c.stage).map((s) => (
              <ActionButton key={s} action={moveCandidateAction.bind(null, c.id, s)} variant="outline">
                {s.charAt(0) + s.slice(1).toLowerCase()}
              </ActionButton>
            ))}
          </div>
        )}
      </Section>

      <Section title="Interviews" description="Moving to the offer stage needs at least one completed interview." flush>
        <Table>
          <THead>
            <TR>
              <TH>Round</TH>
              <TH>When</TH>
              <TH>Interviewer</TH>
              <TH>Mode</TH>
              <TH>Score</TH>
              <TH>Recommendation</TH>
              <TH>Feedback</TH>
            </TR>
          </THead>
          <TBody>
            {c.interviews.map((i) => (
              <TR key={i.id}>
                <TD>{i.round}</TD>
                <TD className="text-xs">{i.scheduledAt.toISOString().slice(0, 16).replace("T", " ")}</TD>
                <TD>{i.interviewer}</TD>
                <TD className="text-xs">{i.mode ?? "—"}</TD>
                <TD>{i.score ? `${i.score}/5` : "—"}</TD>
                <TD>{i.recommendation ? <StatusBadge status={i.recommendation} /> : <span className="text-xs text-muted-foreground">awaiting feedback</span>}</TD>
                <TD className="max-w-sm whitespace-normal text-xs">{i.feedback ?? "—"}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!c.interviews.length && <Empty>No interviews scheduled.</Empty>}
      </Section>
      {manage &&
        c.interviews
          .filter((i) => !i.completedAt && !panelled.has(i.id))
          .map((i) => (
            <FormPanel key={i.id} title={`Record feedback — round ${i.round} with ${i.interviewer}`}>
              <SmartForm
                columns={3}
                submitLabel="Save feedback"
                action={interviewFeedbackAction.bind(null, i.id)}
                fields={[
                  { name: "score", label: "Score (1–5)", type: "select", required: true, options: [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) })) },
                  { name: "recommendation", label: "Recommendation", type: "select", required: true, options: enumOptions(["STRONG_HIRE", "HIRE", "NO_HIRE", "STRONG_NO_HIRE"]) },
                  { name: "feedback", label: "Assessment", type: "textarea", required: true, span: 3 },
                ]}
              />
            </FormPanel>
          ))}
      {screen && screen.criteria.length > 0 && open && (
        <Section
          title="Screening"
          description="Check this candidate against the requisition's criteria. Each answer is met, not met or unclear; a met or not met needs the evidence. This is advice for the people deciding: it never moves, orders or rejects a candidate."
        >
          <SmartForm
            columns={2}
            submitLabel={screen.answers.length ? "Save my corrections" : "Save the answers"}
            resetOnSuccess={false}
            action={recordScreeningAction.bind(null, c.id)}
            fields={screen.criteria.flatMap((cr) => {
              const a = screen.answers.find((x) => x.criterionId === cr.id);
              return [
                { name: `outcome_${cr.id}`, label: `${cr.name} (${cr.kind === "MUST_HAVE" ? "must have" : "preferred"})`, type: "select" as const, required: true, defaultValue: a?.outcome ?? "", options: [{ value: "MET", label: "Met" }, { value: "NOT_MET", label: "Not met" }, { value: "UNCLEAR", label: "Unclear" }] },
                { name: `evidence_${cr.id}`, label: "Evidence (needed for met or not met)", type: "text" as const, defaultValue: a?.evidence ?? "" },
              ];
            })}
          />
        </Section>
      )}
      {screen && open && (
        <Section title="Shortlist" description="A named person's decision, with the reason. It changes nothing else: the candidate's stage is moved by a person.">
          {screen.shortlist && (
            <p className="mb-3 text-sm">
              <StatusBadge status={screen.shortlist.decision} /> {screen.shortlist.reason} <span className="text-xs text-muted-foreground">— {screen.shortlist.decidedBy}</span>
            </p>
          )}
          <SmartForm
            columns={2}
            submitLabel="Record the decision"
            action={decideShortlistAction.bind(null, c.id)}
            fields={[
              { name: "decision", label: "Decision", type: "select", required: true, options: [{ value: "SHORTLISTED", label: "Shortlist" }, { value: "NOT_SHORTLISTED", label: "Do not shortlist" }] },
              { name: "reason", label: "Reason (at least 10 characters)", required: true },
            ]}
          />
        </Section>
      )}
      {panels && (
        <Section title="Interview panels" description="A panel of two to five employees scores each interview. Scorecards stay blind until the scoring is closed. Scores are advice for the people deciding and never rank, filter or reject anyone.">
          {panels.interviews.length === 0 && <Empty>No interviews scheduled.</Empty>}
          {panels.interviews.map((p) => {
            const done = p.members.filter((m) => m.submitted).length;
            return (
              <div key={p.interviewId} className="mb-5 text-sm">
                <p className="font-medium">Round {p.round}</p>
                {p.members.length > 0 ? (
                  <>
                    <ul className="mt-1 list-disc pl-5">
                      {p.members.map((m) => (
                        <li key={m.name}>
                          {m.name}
                          {m.isChair ? " (chair)" : ""}: {m.submitted ? "submitted" : "not yet"}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-1 text-xs text-muted-foreground">{p.closed ? "Scoring closed." : `${done} of ${p.members.length} submitted. Scorecards are read once the scoring closes.`}</p>
                    {!p.closed && (
                      <div className="mt-2">
                        <ActionButton action={closePanelAction.bind(null, p.interviewId)} confirm="Close the scoring now? No scorecard can change afterwards." variant="outline">
                          Close scoring now
                        </ActionButton>
                      </div>
                    )}
                    {p.closed && (
                      <p className="mt-2">
                        <Link className="text-primary underline" href={`/hr/requisitions/${c.requisitionId}/comparison`}>
                          Compare this requisition&apos;s candidates
                        </Link>
                      </p>
                    )}
                  </>
                ) : p.completed ? (
                  <p className="text-xs text-muted-foreground">Scored the old way (one person&apos;s feedback); it cannot be given a panel.</p>
                ) : (
                  <SmartForm
                    columns={3}
                    submitLabel="Set the panel"
                    action={setPanelAction.bind(null, p.interviewId)}
                    fields={[
                      { name: "chair", label: "Chair", type: "select", required: true, options: staff.map((s) => ({ value: s.employeeId, label: s.label })) },
                      ...["m1", "m2", "m3", "m4"].map((n, i) => ({ name: n, label: `Member ${i + 1}${i === 0 ? "" : " (optional)"}`, type: "select" as const, required: i === 0, options: staff.map((s) => ({ value: s.employeeId, label: s.label })) })),
                    ]}
                  />
                )}
              </div>
            );
          })}
        </Section>
      )}
      {panels?.selection && (
        <Section title="Selection" description="The chair recommends; a second person who holds the approval right decides. An offer for a candidate a panel interviewed needs the approved selection.">
          <p className="text-sm">
            <StatusBadge status={panels.selection.status} /> Recommended by {panels.selection.recommendedBy}
          </p>
          <p className="mt-1 max-w-xl whitespace-pre-line text-sm">{panels.selection.note}</p>
          {panels.selection.decidedBy && (
            <p className="mt-1 text-xs text-muted-foreground">
              Decided by {panels.selection.decidedBy}
              {panels.selection.decisionNote ? `: ${panels.selection.decisionNote}` : ""}
            </p>
          )}
          {panels.selection.status === "PENDING" && approve && panels.selection.recommendedById !== ctx.userId && (
            <div className="mt-3 flex gap-2">
              <ActionButton action={approveSelectionAction.bind(null, c.id)} variant="success">
                Approve the selection
              </ActionButton>
              <ActionButton action={declineSelectionAction.bind(null, c.id)} reason reasonPlaceholder="Why decline? (required)" variant="outline">
                Decline
              </ActionButton>
            </div>
          )}
        </Section>
      )}
      {manage && open && (
        <FormPanel title="Schedule an interview">
          <SmartForm
            columns={3}
            submitLabel="Schedule"
            action={scheduleInterviewAction}
            fields={[
              { name: "candidateId", label: "", type: "hidden", defaultValue: c.id },
              { name: "scheduledAt", label: "Date & time", type: "text", required: true, placeholder: "2026-10-12T10:00", help: "YYYY-MM-DDTHH:MM" },
              { name: "interviewer", label: "Interviewer", required: true },
              { name: "mode", label: "Mode", type: "select", options: enumOptions(["IN_PERSON", "PHONE", "VIDEO", "PRACTICAL_TEST"]) },
            ]}
          />
        </FormPanel>
      )}

      <Section
        title="Pre-employment vetting"
        description="Every check must be cleared or waived (with a reason) before this candidate can be hired."
        actions={
          manage &&
          open && (
            <ActionButton action={addStandardChecksAction.bind(null, c.id)} variant="outline">
              Add standard checks
            </ActionButton>
          )
        }
        flush
      >
        <Table>
          <THead>
            <TR>
              <TH>Check</TH>
              <TH>Status</TH>
              <TH>Result / notes</TH>
              <TH>Checked by</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {c.checks.map((k) => (
              <TR key={k.id}>
                <TD>{k.checkType.replace(/_/g, " ")}</TD>
                <TD>
                  <StatusBadge status={k.status} />
                </TD>
                <TD className="max-w-sm whitespace-normal text-xs">{k.notes ?? "—"}</TD>
                <TD className="text-xs">{k.checkedBy ? `${k.checkedBy} · ${fmtDate(k.checkedAt)}` : "—"}</TD>
                <TD>
                  {manage && open && (
                    <div className="flex flex-wrap gap-1">
                      {k.status !== "CLEARED" && (
                        <ActionButton action={updateCheckAction.bind(null, k.id, "CLEARED", "Verified")} variant="success">
                          Clear
                        </ActionButton>
                      )}
                      {k.status !== "FAILED" && (
                        <ActionButton action={updateCheckAction.bind(null, k.id, "FAILED")} reason reasonPlaceholder="What did the check find?" variant="outline">
                          Failed
                        </ActionButton>
                      )}
                      {k.status !== "WAIVED" && (
                        <ActionButton action={updateCheckAction.bind(null, k.id, "WAIVED")} reason reasonPlaceholder="Why is it being waived?" variant="outline">
                          Waive
                        </ActionButton>
                      )}
                    </div>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!c.checks.length && <Empty>No vetting checks yet — add the standard set.</Empty>}
      </Section>
      {manage && open && (
        <FormPanel title="Add a specific check">
          <SmartForm
            columns={3}
            submitLabel="Add check"
            action={addCheckAction}
            fields={[
              { name: "candidateId", label: "", type: "hidden", defaultValue: c.id },
              { name: "checkType", label: "Check", type: "select", required: true, options: CHECKS.map((x) => ({ value: x, label: x.replace(/_/g, " ") })) },
            ]}
          />
        </FormPanel>
      )}

      <Section title="Offers" flush>
        <Table>
          <THead>
            <TR>
              <TH>Offer</TH>
              <TH>Role</TH>
              <TH className="text-right">Monthly gross</TH>
              <TH>Terms</TH>
              <TH>Start / valid until</TH>
              <TH>Status</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {c.offers.map((o) => (
              <TR key={o.id}>
                <TD className="font-mono text-xs">{o.offerNumber}</TD>
                <TD>{o.jobTitle}</TD>
                <TD className="text-right">{naira(o.monthlyGross)}</TD>
                <TD className="text-xs">
                  {o.employmentType.replace(/_/g, " ")} · {o.probationMonths}m probation · {o.noticePeriodDays}d notice
                </TD>
                <TD className="text-xs">
                  {fmtDate(o.startDate)} / {fmtDate(o.validUntil)}
                </TD>
                <TD>
                  <StatusBadge status={o.status} />
                  {o.approvedBy && <div className="mt-0.5 text-[10px] text-muted-foreground">by {o.approvedBy}</div>}
                </TD>
                <TD>
                  <div className="flex flex-wrap gap-1">
                    {approve && o.status === "PENDING_APPROVAL" && o.createdById !== ctx.userId && (
                      <>
                        <ActionButton action={approveOfferAction.bind(null, o.id)} variant="success">
                          Approve
                        </ActionButton>
                        <ActionButton action={rejectOfferAction.bind(null, o.id)} reason reasonPlaceholder="Reason for rejecting" variant="outline">
                          Reject
                        </ActionButton>
                      </>
                    )}
                    {o.status === "PENDING_APPROVAL" && o.createdById === ctx.userId && (
                      <span className="text-xs text-muted-foreground">needs another approver</span>
                    )}
                    {manage && o.status === "APPROVED" && (
                      <ActionButton action={markOfferSentAction.bind(null, o.id)}>Mark sent</ActionButton>
                    )}
                    {manage && o.status === "SENT" && (
                      <>
                        <ActionButton action={offerResponseAction.bind(null, o.id, "ACCEPTED")} variant="success">
                          Accepted
                        </ActionButton>
                        <ActionButton action={offerResponseAction.bind(null, o.id, "DECLINED")} reason reasonPlaceholder="Why did they decline?" variant="outline">
                          Declined
                        </ActionButton>
                      </>
                    )}
                    {manage && ["APPROVED", "SENT", "ACCEPTED"].includes(o.status) && (
                      <ActionButton action={generateLetterAction.bind(null, { type: "OFFER", offerId: o.id })} variant="outline">
                        Offer letter
                      </ActionButton>
                    )}
                    {manage && ["PENDING_APPROVAL", "APPROVED", "SENT"].includes(o.status) && (
                      <ActionButton action={withdrawOfferAction.bind(null, o.id)} reason reasonPlaceholder="Why withdraw?" variant="outline">
                        Withdraw
                      </ActionButton>
                    )}
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!c.offers.length && <Empty>No offers yet.</Empty>}
      </Section>

      {manage && accepted && c.stage === "OFFER" && (
        <Section
          title="Hire"
          description="Creates the employee, their employment contract, a personal pay rate (if the offer sets one) and the onboarding checklist — all at once."
        >
          <SmartForm
            columns={3}
            submitLabel="Hire this candidate"
            resetOnSuccess={false}
            action={hireCandidateAction}
            fields={[
              { name: "offerId", label: "", type: "hidden", defaultValue: accepted.id },
              { name: "employmentDate", label: "Employment date", type: "date", defaultValue: accepted.startDate.toISOString().slice(0, 10), help: "Defaults to the offer's start date." },
              { name: "signedDate", label: "Contract signed on", type: "date" },
              { name: "documentReference", label: "Signed contract reference" },
            ]}
          />
        </Section>
      )}
      {manage && c.stage === "OFFER" && !liveOffer && !accepted && (
        <FormPanel title="Raise an offer" open>
          <SmartForm
            columns={3}
            submitLabel="Raise offer"
            action={createOfferAction}
            fields={[
              { name: "candidateId", label: "", type: "hidden", defaultValue: c.id },
              { name: "jobTitle", label: "Job title", required: true, defaultValue: c.requisition.title },
              { name: "monthlyGross", label: "Monthly gross (₦)", type: "number", required: true, min: 1, defaultValue: c.expectedMonthlyGross ? Number(c.expectedMonthlyGross) : undefined, help: c.requisition.budgetedMonthlyGross ? `Budget: ${naira(c.requisition.budgetedMonthlyGross)}` : undefined },
              { name: "employmentType", label: "Employment type", type: "select", defaultValue: c.requisition.employmentType, options: enumOptions(TYPES) },
              { name: "probationMonths", label: "Probation (months)", type: "number", min: 0 },
              { name: "noticePeriodDays", label: "Notice period (days)", type: "number", min: 0 },
              { name: "startDate", label: "Start date", type: "date", required: true },
              { name: "validUntil", label: "Offer valid until", type: "date" },
              { name: "setPayRate", label: "Create a personal pay rate on hire (office staff — leave off for guards paid from the client contract)", type: "checkbox", defaultValue: true, span: 3 },
            ]}
          />
        </FormPanel>
      )}
    </>
  );
}
