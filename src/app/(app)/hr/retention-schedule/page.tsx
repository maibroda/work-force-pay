import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { dueView, getSchedule } from "@/server/services/retention-schedule";
import { listRuns } from "@/server/services/retention-run";
import { isRunnable } from "@/lib/retention-run";
import {
  RETENTION_ACTIONS,
  RETENTION_ACTION_LABELS,
  RETENTION_CATEGORIES,
  RETENTION_CATEGORY_LABELS,
  RETENTION_TRIGGERS,
  RETENTION_TRIGGER_LABELS,
} from "@/lib/retention-schedule";
import { fmtDate } from "@/lib/dates";
import { fullName } from "@/lib/utils";
import { Empty, FormPanel, PageHeader, Section, Stat, StatGrid } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { SmartForm } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { placeHoldAction, releaseHoldAction, updateRuleAction, verifyRuleAction } from "@/app/actions/retention-schedule";
import { confirmRunAction, proposeRunAction, rejectRunAction } from "@/app/actions/retention-run";

const categoryOptions = RETENTION_CATEGORIES.map((c) => ({ value: c, label: RETENTION_CATEGORY_LABELS[c] }));

/** The retention schedule, the legal holds, what is due and the retention runs. The schedule is a record for the legal adviser; the only thing here that removes anything is a confirmed run. */
export default async function RetentionSchedulePage() {
  const ctx = await requirePage("hr.view");
  const manageRules = can(ctx.role, "retention.manage");
  const placeHolds = can(ctx.role, "hr.manage");
  const [schedule, due, { runs }] = await Promise.all([getSchedule(ctx), dueView(ctx), listRuns(ctx)]);
  const confirmRuns = can(ctx.role, "retention.manage");
  // a run can be proposed for a kind of record a run is offered for, whose rule says anonymise, that has something past its period and no proposal already waiting
  const proposable = due.categories.filter((c) => isRunnable(c.category) && c.measured && !c.off && c.action === "ANONYMISE" && c.due - c.held > 0 && !runs.some((r) => r.category === c.category && r.status === "PROPOSED"));
  const live = schedule.holds.filter((h) => !h.released);
  const people = placeHolds ? await db.employee.findMany({ where: { organizationId: ctx.orgId }, orderBy: { employeeNumber: "asc" }, select: { id: true, employeeNumber: true, firstName: true, lastName: true, status: true } }) : [];
  return (
    <>
      <PageHeader
        title="Retention schedule and legal holds"
        description="How long each kind of record is kept, counted from what, and what happens then. The periods are the founder's proposals and are NOT legal advice: each is marked unverified until the company's legal adviser has seen it. Changing the schedule removes nothing. What removes the words of a record is a retention run (below): HR proposes it and a different person confirms it. The other deletions that exist (erasing a former employee, anonymising old applicants, purging old survey answers) run from their own HR-policy settings, shown below, and every one of them stops while a legal hold covers what it would remove."
      />
      <StatGrid cols={3}>
        <Stat label="Rules the adviser has not verified" value={`${schedule.unverified} of ${schedule.rules.length}`} tone={schedule.unverified ? "amber" : "green"} />
        <Stat label="Legal holds in place" value={live.length} tone={live.length ? "amber" : "green"} />
        <Stat label="Holds to review now" value={live.filter((h) => h.needsReview).length} tone={live.some((h) => h.needsReview) ? "red" : "green"} />
      </StatGrid>

      {placeHolds && (
        <FormPanel title="Place a legal hold">
          <SmartForm
            columns={3}
            submitLabel="Place hold"
            action={placeHoldAction}
            fields={[
              {
                name: "scope",
                label: "Covers",
                type: "select",
                required: true,
                options: [
                  { value: "EMPLOYEE", label: "One person" },
                  { value: "CATEGORY", label: "One kind of record" },
                  { value: "COMPANY", label: "The whole company" },
                ],
              },
              { name: "employeeId", label: "The person (if one person)", type: "select", options: people.map((e) => ({ value: e.id, label: `${e.employeeNumber} — ${fullName(e)}` })) },
              { name: "category", label: "The kind of record (if one kind)", type: "select", options: categoryOptions },
              { name: "reviewOn", label: "Look at it again on", type: "date", required: true, help: "Must be after today." },
              { name: "reason", label: "Why (a dispute, an investigation, a regulator's request)", type: "textarea", required: true, span: 2 },
            ]}
          />
          <p className="mt-2 text-xs text-muted-foreground">Any HR administrator can place a hold. Only the Company Administrator can release it. A hold on a person stops their records being erased; a hold on the applicants or the survey answers stops those runs.</p>
        </FormPanel>
      )}

      <Section title="Legal holds" flush>
        {schedule.holds.length === 0 ? (
          <Empty>No legal hold has been placed.</Empty>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Covers</TH>
                <TH>Why</TH>
                <TH>Placed by</TH>
                <TH>Status</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {schedule.holds.map((h) => (
                <TR key={h.id}>
                  <TD className="text-xs">
                    {h.scope === "COMPANY" && "The whole company"}
                    {h.scope === "CATEGORY" && (h.category ? RETENTION_CATEGORY_LABELS[h.category] : "A kind of record")}
                    {h.scope === "EMPLOYEE" && (h.employeeName ? `${h.employeeNumber} — ${h.employeeName}` : "One person")}
                  </TD>
                  <TD className="max-w-[22rem] whitespace-normal text-xs text-muted-foreground">{h.reason ?? "Not shown to your role."}</TD>
                  <TD className="text-xs">
                    {h.placedBy}
                    <div className="text-muted-foreground">{fmtDate(h.placedAt)}</div>
                  </TD>
                  <TD className="max-w-[18rem] whitespace-normal text-xs">
                    {h.released ? (
                      <>
                        <Badge tone="gray">Released {fmtDate(h.releasedAt)}</Badge>
                        <div className="mt-1 text-muted-foreground">
                          {h.releasedBy}
                          {h.releaseReason ? ` — ${h.releaseReason}` : ""}
                        </div>
                      </>
                    ) : (
                      <>
                        <Badge tone={h.needsReview ? "red" : "amber"}>{h.needsReview ? "Review now" : "In place"}</Badge>
                        <div className="mt-1 text-muted-foreground">Review on {fmtDate(h.reviewOn)}</div>
                      </>
                    )}
                  </TD>
                  <TD className="text-right">
                    {manageRules && !h.released && (
                      <ActionButton action={releaseHoldAction.bind(null, h.id)} reason reasonPlaceholder="Why it is being released" variant="outline">
                        Release
                      </ActionButton>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Section>

      <Section title="What is due" flush>
        <Table>
          <THead>
            <TR>
              <TH>Kind of record</TH>
              <TH>Past its period</TH>
              <TH>Within 90 days</TH>
              <TH>Held by a legal hold</TH>
              <TH>Then</TH>
            </TR>
          </THead>
          <TBody>
            {due.categories.map((c) => (
              <TR key={c.category}>
                <TD className="text-xs">{c.label}</TD>
                {!c.measured ? (
                  <TD colSpan={4} className="max-w-[28rem] whitespace-normal text-xs text-muted-foreground">
                    Not measured: {c.reason}
                  </TD>
                ) : c.off ? (
                  <TD colSpan={4} className="text-xs text-muted-foreground">
                    Switched off, or kept: nothing becomes due
                  </TD>
                ) : (
                  <>
                    <TD className="text-xs">
                      {c.due} <span className="text-muted-foreground">{c.unit === "people" ? (c.due === 1 ? "person" : "people") : c.due === 1 ? "record" : "records"}</span>
                    </TD>
                    <TD className="text-xs">{c.soon === null ? <span className="text-muted-foreground">Not worked out</span> : c.soon}</TD>
                    <TD className="text-xs">{c.held}</TD>
                    <TD className="text-xs">{c.actionLabel}</TD>
                  </>
                )}
              </TR>
            ))}
          </TBody>
        </Table>
        <p className="px-4 py-2 text-xs text-muted-foreground">Counts only. People means former employees who still hold a record of that kind; records means the records themselves. Nothing in this table removes anything: Review means HR looks at it, and Anonymise is carried out only by a confirmed run.</p>
      </Section>

      <Section title="Retention runs" flush>
        <p className="px-4 pt-3 text-xs text-muted-foreground">
          A run clears the <strong>words</strong> of one kind of record for the people (or records) whose period has ended, and keeps the shape: that a record existed, its kind, dates and outcome. HR proposes a run; a different person, the Company
          Administrator, confirms it, no sooner than a minute later. <strong>It cannot be undone: back up the database before the first run.</strong> A rule the legal adviser has not verified runs only if the person confirming writes down why they
          accept it. A legal hold, an open case or an open data request always keeps a person out of a run.
        </p>
        {placeHolds && (
          <div className="px-4 py-3">
            {proposable.length ? (
              <SmartForm
                columns={2}
                submitLabel="Propose a run"
                action={proposeRunAction}
                fields={[
                  {
                    name: "category",
                    label: "Kind of record",
                    type: "select",
                    required: true,
                    options: proposable.map((c) => ({ value: c.category, label: `${c.label} — ${c.due - c.held} ${c.unit === "people" ? (c.due - c.held === 1 ? "person" : "people") : c.due - c.held === 1 ? "record" : "records"} past the period` })),
                    help: "Only kinds of record that are set to anonymise and have something past their period are listed.",
                  },
                ]}
              />
            ) : (
              <p className="text-xs text-muted-foreground">Nothing can be proposed now: no kind of record that is set to anonymise has something past its period that a hold or an open case does not cover, or a proposal is already waiting.</p>
            )}
          </div>
        )}
        {runs.length === 0 ? (
          <Empty>No run has been proposed.</Empty>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Kind of record</TH>
                <TH>Covers</TH>
                <TH>Rule</TH>
                <TH>Proposed by</TH>
                <TH>Status</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {runs.map((r) => (
                <TR key={r.id}>
                  <TD className="text-xs">{r.label}</TD>
                  <TD className="max-w-[14rem] whitespace-normal text-xs">
                    {r.itemCount} item(s)
                    {(r.skippedHeld > 0 || r.skippedOpen > 0) && (
                      <div className="text-muted-foreground">
                        left out at the proposal: {r.skippedHeld} held, {r.skippedOpen} with something open
                      </div>
                    )}
                  </TD>
                  <TD className="text-xs">
                    {r.periodMonths} months <Badge tone={r.ruleVerified ? "green" : "amber"}>{r.ruleVerified ? "Verified" : "Unverified"}</Badge>
                  </TD>
                  <TD className="text-xs">
                    {r.proposedBy}
                    <div className="text-muted-foreground">{fmtDate(r.proposedAt)}</div>
                  </TD>
                  <TD className="max-w-[18rem] whitespace-normal text-xs">
                    {r.status === "PROPOSED" && <Badge tone="amber">Waiting for confirmation</Badge>}
                    {r.status === "EXECUTED" && <Badge tone="green">Done</Badge>}
                    {r.status === "REJECTED" && <Badge tone="gray">Turned down</Badge>}
                    {r.decidedBy && (
                      <div className="mt-1 text-muted-foreground">
                        {r.decidedBy}, {fmtDate(r.decidedAt)}
                        {r.decisionNote ? ` — ${r.decisionNote}` : ""}
                      </div>
                    )}
                    {r.status === "EXECUTED" && (
                      <div className="mt-1 text-muted-foreground">
                        {r.clearedItems} cleared, {r.skippedAtConfirm} left out
                        {r.acceptedUnverified ? "; rule was unverified, accepted in writing" : ""}
                        {r.singleHolder ? "; confirmed by the person who proposed it, as the only holder" : ""}
                      </div>
                    )}
                  </TD>
                  <TD className="space-x-1 whitespace-nowrap text-right">
                    {r.status === "PROPOSED" && confirmRuns && (
                      <ActionButton
                        action={confirmRunAction.bind(null, r.id)}
                        reason
                        reasonPlaceholder={r.ruleVerified ? "Why you are confirming (10+ characters). This clears the words for good." : "The rule is unverified: write why you accept it (20+ characters). This clears the words for good."}
                        variant="success"
                      >
                        {r.waitSeconds > 0 ? "Confirm (wait a minute)" : "Confirm and clear"}
                      </ActionButton>
                    )}
                    {r.status === "PROPOSED" && (confirmRuns || r.mine) && (
                      <ActionButton action={rejectRunAction.bind(null, r.id)} reason reasonPlaceholder="Why it is being turned down" variant="outline">
                        Turn down
                      </ActionButton>
                    )}
                    {r.status === "PROPOSED" && r.mine && confirmRuns && <div className="text-xs text-muted-foreground">You proposed this: 20+ characters if you are the only person who can confirm</div>}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Section>

      <Section title="The schedule" flush>
        <Table>
          <THead>
            <TR>
              <TH>Kind of record</TH>
              <TH>Kept for</TH>
              <TH>Then</TH>
              <TH>Applied by the system today</TH>
              <TH>Legal adviser</TH>
            </TR>
          </THead>
          <TBody>
            {schedule.rules.map((r) => (
              <TR key={r.category}>
                <TD className="max-w-[16rem] whitespace-normal text-xs">
                  {r.label}
                  {r.note && <div className="text-muted-foreground">{r.note}</div>}
                </TD>
                <TD className="text-xs">{r.action === "KEEP" ? "Kept" : `${r.periodMonths} months, ${r.triggerLabel}`}</TD>
                <TD className="text-xs">{r.actionLabel}</TD>
                <TD className="max-w-[16rem] whitespace-normal text-xs">
                  {r.applied ? (
                    <>
                      {r.applied.value === 0 ? "Switched off" : `${r.applied.value} ${r.applied.unit}`}
                      <div className="text-muted-foreground">from the HR policy setting; change it under Settings → HR &amp; lifecycle policy</div>
                    </>
                  ) : (
                    <span className="text-muted-foreground">No: this is a schedule only</span>
                  )}
                </TD>
                <TD className="max-w-[16rem] whitespace-normal text-xs">
                  {r.verified ? (
                    <>
                      <Badge tone="green">Verified</Badge>
                      <div className="mt-1 text-muted-foreground">
                        {r.verifiedBy}, {fmtDate(r.verifiedOn)}
                        {r.verifiedNote ? ` — ${r.verifiedNote}` : ""}
                      </div>
                    </>
                  ) : (
                    <Badge tone="amber">Unverified</Badge>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Section>

      {manageRules && (
        <>
          <FormPanel title="Change a rule">
            <SmartForm
              columns={3}
              submitLabel="Change rule"
              action={updateRuleAction}
              fields={[
                { name: "category", label: "Kind of record", type: "select", required: true, options: categoryOptions },
                { name: "periodMonths", label: "Kept for (months)", type: "number", required: true, min: 0, max: 1200, help: "Delete or anonymise needs at least 1; Keep needs 0." },
                { name: "trigger", label: "Counted from", type: "select", required: true, options: RETENTION_TRIGGERS.map((t) => ({ value: t, label: RETENTION_TRIGGER_LABELS[t] })) },
                { name: "action", label: "Then", type: "select", required: true, options: RETENTION_ACTIONS.map((a) => ({ value: a, label: RETENTION_ACTION_LABELS[a] })) },
                { name: "note", label: "Why this period", span: 2 },
              ]}
            />
            <p className="mt-2 text-xs text-muted-foreground">Changing a rule clears the legal adviser&apos;s verification of it. Changing a rule here does not change what the system deletes today: that follows the HR policy settings shown above.</p>
          </FormPanel>
          <FormPanel title="Record that the legal adviser has seen a rule">
            <SmartForm
              columns={3}
              submitLabel="Record"
              action={verifyRuleAction}
              fields={[
                { name: "category", label: "Kind of record", type: "select", required: true, options: categoryOptions },
                { name: "verifiedBy", label: "Legal adviser's name", required: true },
                { name: "verifiedOn", label: "Seen on", type: "date", required: true },
                { name: "note", label: "Note (optional)", span: 3 },
              ]}
            />
          </FormPanel>
        </>
      )}
      {!manageRules && <p className="text-xs text-muted-foreground">Only the Company Administrator can change a rule, record the adviser&apos;s verification or release a hold.</p>}
    </>
  );
}
