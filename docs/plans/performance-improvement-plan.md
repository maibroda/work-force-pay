# Performance management, step (b): a structured performance improvement plan (PIP)

Written 2026-11-07. **A proposal only: nothing is built and no migration is written until the founder answers the questions in section 6 and says "go".** It is item 4(b) in the build order of `docs/plans/founder-decisions-2026-11-05.md` (job descriptions and KPIs are done in #157; then the PIP; then continuous feedback; then the probation review). Several answers below touch employment-law practice: where I propose a number or a rule it is a **proposal for the founder to confirm or replace, and a lawyer should review the wording before a company relies on it**. I have not assumed any Nigerian labour-law rule.

## 1. What exists today (checked in the code on 2026-11-07)

- **Appraisals** (`src/server/services/appraisals.ts`): on approval the reviewer records a **recommendation**, one of which is **"Performance improvement plan"** (`PERFORMANCE_PLAN`). It is only a label: it starts nothing, and nobody is reminded of anything. The reviewer's **"areas to improve"** text is already on the appraisal.
- **Misconduct and sanctions** (the Disciplinary area, permissions `discipline.*`) are a separate process with hearings, appeals and signed-off sanctions. They are about **conduct**. A PIP is about **capability and results**, and the two must not be mixed: a PIP is not a sanction, and nothing here issues one.
- **Reminders:** the HR daily digest (`src/server/services/reminders.ts`) already lists appraisals overdue or awaiting approval, contracts ending and probation reviews; it is the right place for "a plan review is due".
- **Self-service:** employees already see and acknowledge their own appraisals (`/me/appraisals`), with an agree or disagree answer and a comment.
- **Not there:** a structured plan with gaps, measurable targets, support, review milestones and an outcome; any employee-facing view of one; any reminder.
- **No "line manager" link exists on the employee record** (the only supervisor link is a beat supervisor for operations). So "the manager of this employee" cannot be worked out by the system today (see question 2).

## 2. What the PIP adds

A **plan** for one employee, run by HR with a named **plan owner** (a person who reviews progress), moving through fixed steps:

1. **Draft** (HR): the employee, the **concerns** (what is not meeting the standard, in plain words), the **start and end dates**, and the **plan owner**. Optionally **started from an appraisal** whose recommendation was "Performance improvement plan" (one button on that appraisal; the improvement text is copied across; **never automatic**, because a score must not start a process on its own).
2. **Objectives** (one or more): the **gap**, the **measurable target** (free text plus an optional number and unit, the same units as KPIs), the **support the company will give** (training, coaching, equipment), and a **due date**. Each objective is later marked **Met, Partly met or Not met** with a note.
3. **Approval to start** (a **second person**, never the drafter): the plan becomes **Active** only when someone holding the approve permission other than the drafter signs it off. This is the same maker and checker rule used for job descriptions, sanctions and documents.
4. **The employee is told and responds:** the employee sees the plan under **My improvement plan** (read-only), and **acknowledges** it with **Agree or Disagree and a comment** (as appraisals do). A disagreement does not stop the plan; it is recorded and shown to the approver at the end. The employee's response is kept as written.
5. **Review milestones:** the plan owner records a **review** at each milestone (date, assessment of each objective, notes, and the employee's comment if any). Reviews are append-only. **Dates that fall due or are overdue appear in the HR daily digest and the HR overview.**
6. **Outcome** (decided at or after the last review, **approved by a second person**): **Successful** (the plan closes; the standard is met), **Extended** (a new end date and a reason, within the limits in the settings), **Unsuccessful** (the plan closes), or **Withdrawn** (cancelled with a reason). **Unsuccessful does not do anything else by itself**: it is a recorded outcome and a prompt for HR to decide what follows (see question 5).
7. **Everything is audited by ids and field names**, never the text of concerns or comments (the audit log is append-only and an erasure request must be possible without touching it).

**Limits are data, not code:** the default plan length, the longest allowed, the number of extensions and the longest extension live in the HR policy settings with who changed them and when (CLAUDE.md rule 3 spirit). **My proposed defaults, for the founder to confirm or replace:** default 60 days, longest 90 days, at most 1 extension, of at most 30 days. A lawyer should confirm what is reasonable for the company's contracts.

## 3. The rules in plain terms (with a worked example)

- **Who starts, who approves:** HR (`pip.manage`) drafts; someone else with `pip.approve` activates and later approves the outcome. **The plan owner cannot be the approver of their own plan's outcome if they also drafted it.**
- **Status moves only forward along fixed steps:** Draft, Awaiting approval, Active, then Closed with an outcome (or Withdrawn). A closed plan can never be reopened; a new plan is a new record. Extension keeps the plan Active.
- **At most one open plan per employee** at a time (Draft, Awaiting approval or Active).
- **A leaver's plan is closed as Withdrawn** by an HR action when the exit is approved (proposal: the exit page prompts; it is not automatic).
- **Worked example:** a guard's appraisal ends with the recommendation "Performance improvement plan" and the improvement note "arrives late to post; incident reports incomplete". HR starts a plan from that appraisal: 60 days, owner = the operations manager. Objective 1: "no late arrival in the last 30 days of the plan" (target 0, unit count), support "shift swap to a closer post", due day 60. Objective 2: "incident reports complete on the same day" (target 100%, unit percentage), support "report-writing refresher", due day 45. The company administrator approves; the guard sees it and acknowledges "Agree". At day 30 the owner records a review: objective 2 Partly met. At day 60: objective 1 Met, objective 2 Met. HR proposes the outcome **Successful**; the company administrator approves it; the plan closes. Nothing changes in pay or status.

## 4. Files, migration, permissions and tests (once approved)

- **Migration (additive, reversible, round-tripped on a copy of the seeded database):** tables `PerformanceImprovementPlan`, `PipObjective`, `PipReview` (with the objective assessments), enums for the plan status, outcome and objective result, and four columns on the HR policy for the limits. No existing column changes meaning; no existing data is rewritten.
- **Pure functions first** (`src/lib/pip.ts`): the allowed status moves, whether a plan or milestone is due or overdue, whether an extension is within the limits, the end date from the start and length. **Unit tests first**, including the worked example, the edges of each limit and every forbidden move.
- **Services and screens:** HR > Performance management > **Improvement plans** (list, plan page with objectives, reviews and outcome); a **"Start a plan"** button on an approved appraisal with that recommendation; **My improvement plan** under My HR for the employee; the daily digest and HR overview lines; the limits in the HR policy page. Every page declared in `entry-modules.ts` (module `hr`; the self-service page `self_service`) and in the navigation.
- **Permissions (new):** `pip.view` (see plans), `pip.manage` (draft, record reviews, propose outcomes), `pip.approve` (activate a plan, approve the outcome, never the drafter). **Proposed grants:** HR administrator `pip.view` and `pip.manage`; company administrator and super administrator all three; **the auditor `pip.view`** (read-only); the employee sees only their own through self-service. Finance and operations roles get none. PIPs are personal and sensitive, so they are **not** under the general `hr.view`.
- **Tests (integration, written first):** another company cannot see or touch a plan; the drafter cannot approve their own plan or its outcome; an employee sees only their own plan and nobody else's, and cannot change it; an unapproved plan is invisible to the employee; one open plan per employee; reviews are append-only; a forbidden status move is refused; extensions beyond the limits are refused; the audit log records ids and field names and never the concerns, objectives or comments; a role without `pip.view` is refused on every page and action; starting from an appraisal copies the improvement text and does not change the appraisal.
- **Documents:** release notes, the data dictionary (regenerated), an explain-back note for the status rules and the approvals.

## 5. What is not in this step

Continuous feedback, the probation review ending in a confirmation decision, performance analytics, **letters** generated from a plan (a PIP letter through the existing Letters module is a sensible follow-up), **any link to pay** (no increment, promotion or deduction follows from a plan), **any automatic disciplinary or termination step**, and notifications to the employee by email or SMS (the employee sees the plan when they sign in).

## 6. Questions for the founder (my recommendation in bold)

1. **Is a PIP its own workflow, separate from the Disciplinary area?** **Yes**: a PIP is about capability, a sanction is about conduct, and mixing them would put a performance problem on a person's misconduct record.
2. **Who may see a plan, and who is "the manager"?** The system has no line-manager link, so I propose **HR-run plans with a named plan owner chosen from the HR users** (plan owner = a person who reviews progress), and **no general manager access**. If you want line managers to see their own team's plans, that needs a manager link on the employee record first (a separate, small change). **Proposed: HR administrator and company administrator see and manage; the auditor sees read-only; the plan owner sees the plans they own.**
3. **The limits (settings):** **default 60 days, longest 90, one extension of at most 30 days.** Please confirm or give your numbers, and have your lawyer review them.
4. **Second-person approval** to start a plan and to approve its outcome: **yes both** (so one person cannot start a process against an employee and conclude it alone).
5. **What follows an Unsuccessful outcome?** **Nothing automatic.** The plan closes and shows "Unsuccessful: decide the next step", and HR chooses (another plan, a transfer, a capability hearing, an exit) through the existing processes. Do you want a **"capability" case type** in the Disciplinary area for that hearing, or is the existing case system enough for now?
6. **The employee's rights:** the employee **sees the plan, acknowledges it with Agree or Disagree and a comment, and may add a comment at each review**. Should the employee also be able to **upload supporting evidence** (this would use the new document store)? **Not in this step; add later if needed.**
7. **Legal review:** please confirm that **a lawyer will review the wording** (the plan's screens, any letter later) before a company uses this for a real employee. I will not write legal advice into the screens.

## 7. Suggested order of work once you say "go"

One pull request with one migration: (1) the pure functions and their unit tests, (2) the schema and migration (your "go" covers it, as for the earlier ones), (3) the services and integration tests, (4) the screens and the reminder lines, (5) docs, the explain-back note and the full suite, (6) browser checks with HR, a second approver, the employee and the auditor, and a report.
