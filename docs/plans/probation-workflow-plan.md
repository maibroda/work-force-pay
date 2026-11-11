# Probation workflow: recommend, HR review, independent decision, employee response

Written 2026-11-11. **A proposal only: nothing is built and no migration is written until you answer the questions in section 7 and say "go".** It is item 2 of `docs/plans/founder-decisions-2026-11-10-hr.md` ("Probation workflow: needs a plan") and the probation instance of the role-separation rule in item 6 (`docs/plans/hr-governance-plan.md`). It changes **who may decide something about a person's employment and what the employee is told**, so it touches approvals and access control and needs your "go" and, for the migration, your separate "go" (CLAUDE.md). I have stated no Nigerian employment-law rule; where something is a legal question I say so and put it on the lawyer list.

## 1. What your register asks for

> The reporting manager **recommends** (confirm, extend or not confirm); **HR reviews** against the probation policy; an **authorised independent manager or department head makes the final decision**; the employee receives **documented feedback and a chance to respond**; a failed probation triggers **no automatic exit**.

## 2. What exists today (checked in the code on 2026-11-11)

- **`decideProbation`** (`src/server/services/contracts.ts`, needs `hr.approve`): Confirm (permanent contract from a chosen date), Extend (1 to 12 months, within the company's longest probation) or Fail; a reason for Extend and Fail. It is the **only** place that changes the contract's probation outcome, and it must stay so.
- **Already built (the probation review decision record, merged earlier):** an append-only decision record (`ProbationDecision`) with a **snapshot of the signed-off probation appraisal**; the appraisal's **reviewer and signer cannot decide**; a decision **against the appraisal's recommendation** needs a fuller reason and is marked; after Fail only a "no exit started" prompt; escalation of an undecided probation after `probationEscalationDays`; the employee sees **one line, only after HR marks them told, never the reasons**; erasure removes the reasons.
- **The reporting line exists** (`Employee.reportingManagerId`) and the "a manager acts only for their own direct reports" pattern is used by feedback, skills and training requests. The appraisal already has an employee **acknowledge or dispute** step with a written response (`acknowledgeAppraisal`).
- **There is no department head** in the data (a department has a code and a name only).

## 3. The gaps against your flow

1. **No manager recommendation step.** HR decides; the manager's view is only the appraisal.
2. **No separate HR review.** The person who decides is the HR approver; nothing records a review against the policy first.
3. **No independent final decider.** Today the decider holds `hr.approve` (the HR administrator or company administrator) and only the appraisal's reviewer and signer are excluded. Nothing stops the same HR person who prepared everything from deciding.
4. **The employee gets one line, not documented feedback, and has no chance to respond.**
5. **No way to name "an authorised independent manager or department head"** as a decider.

## 4. The design

**One review round per probation (and per extension), moving through fixed steps. Every step is a record that is added, never edited.**

1. **Recommendation** (the employee's reporting manager). Confirm, Extend (months) or Not confirm, with a reasoned note (at least 20 characters). The appraisal behind it is snapshotted as today. A manager recommends only for their own direct report; nobody for themselves. Open from the alert window before the end date (`probationAlertDays`, default 30) until decided.
2. **HR review** (`hr.manage`, a different person from whoever recorded the recommendation). HR sees the policy checks computed for it (signed-off appraisal present, minimum score met, probation length within the maximum) and records **Forward to the decider** or **Return to the manager** with a note. HR cannot change the recommendation.
3. **Independent decision.** Only a **designated decider** may decide: the Company Administrator (and platform staff), and any user the Company Administrator designates (for example a department head), optionally scoped to a department. **Never** the recommending manager, the HR reviewer, the appraisal's reviewer or signer, or the employee. A decision against the recommendation or the HR review needs the fuller reason and is marked (as today). The decision goes through the existing `decideProbation` logic, so the contract changes exactly as it does now, in the same transaction as the record.
4. **Documented feedback to the employee.** The decider writes a short plain statement for the employee (up to 1,000 characters; required for Extend and Not confirmed, optional for Confirm): what was found and what happens next. It is separate from the internal reason and is shown to the employee only after HR marks them told (the existing mechanism).
5. **The employee's response.** Within a window (HR policy, default **7** days, 0 = no window) the employee may respond once, agreeing or disagreeing with a comment (a sentence if they disagree, as for appraisals). It is attached to the record and **changes nothing by itself**: no automatic reversal, no exit. HR and the decider see it in the digest until the decider records that they **read it**. A change of mind is a **new decision by a designated decider with a reason**, never an edit.
6. **After "Not confirmed"** nothing else happens by itself (the existing prompt and link to the Exits process remain). Notice, pay and any hearing the contract or law requires are for HR and your adviser.

**A switch, default off.** The new flow is behind an HR policy setting (`probationWorkflow`, default OFF, CLAUDE.md rule 8). While it is off, nothing changes: today's `decideProbation` flow and all its tests stay as they are. When it is on, `decideProbation` refuses to act unless a review has been forwarded to the decider and the caller is a designated decider.

**If nobody is eligible** (for example one administrator who is also the HR reviewer), the page says so and the Company Administrator sees a notice to designate someone. **Nothing lets a person bypass the separation.**

## 5. Data, migration, permissions

- **Migration (additive, reversible, round-tripped up/down/up on a copy of the seeded database):** `ProbationReview` (one row per round: recommendation, HR review, decision link, feedback, response and read marks, each with who and when); `ProbationDecider` (a designated user, an optional department, who granted it, when, revoked at); a few enums; two `HrPolicy` columns (`probationWorkflow`, `probationResponseDays`); one optional `reviewId` on `ProbationDecision`. No existing column changes meaning. The down script drops the new tables and columns.
- **Permissions:** the recommendation and the employee's response need no new permission (the reporting line and "it is my own record" decide, as for feedback and appraisals). The review uses `hr.manage`. The decision is **not** a role permission: a department head holds no HR role. It is decided by the designation table, checked on the server in the service (and the page), as manager-over-direct-report already is. Designating deciders needs a new permission held by the Company Administrator and platform staff only, not the HR administrator, in the same way as `hr.officer.manage`.
- **Audit:** by ids, the step and the outcome kind, never the note, the feedback or the response. **Personal data:** the notes, feedback and response are in the employee's copy of their data and are removed on erasure (the shape stays), with tests in the same change.

## 6. Tests first

Unit (`src/lib/probation.ts` neighbours): the allowed step order; who may act at each step; the independence rule (recommender, HR reviewer, appraisal reviewer and signer, employee are each excluded); the response window. Integration, written before the code: each step records one row; a manager cannot recommend for someone who is not their direct report or for themselves; HR cannot review their own recommendation; HR cannot decide; a non-designated user, the recommender, the reviewer and the appraisal's reviewer or signer are each refused; with the switch off the old flow behaves exactly as before; with it on, `decideProbation` refuses without a forwarded review; the contract changes only through the one function, in one transaction with the records; Return sends it back and a new recommendation is needed; feedback is invisible to the employee until marked told, then readable; one response only, inside the window, never after; a response changes nothing and shows in the digest until read; a changed decision is a new record; nothing edits or deletes a row; the audit log carries no text; erasure removes the text and keeps the shape; another company sees and does nothing; revoking a designation takes effect on the next request.

## 7. Questions for you (my recommendation in bold)

1. **Ship it behind a switch that defaults OFF**, so no company's current probation process changes until you turn it on? **Yes.**
2. **Who may be a final decider:** the Company Administrator plus users they designate (a department head or an independent manager), optionally limited to a department, never anyone in the chain above. **Yes.** Or would you rather it be the Company Administrator alone for now?
3. **A different person must do the HR review** from whoever recorded the recommendation. **Yes.**
4. **An employee with no reporting manager:** HR may record the recommendation (marked "recorded by HR"), and a different HR person reviews. **Yes**; or block until a manager is named?
5. **Order of events:** the decision **takes effect when made** (as today); the employee then receives feedback and may respond; a response **never reverses it by itself**, and a change of mind is a new, reasoned decision. **Yes.** The alternative, **holding a Not confirmed decision until the response window ends**, is attractive but may be a legal question (whether an employee must be heard before a decision): **is it for your lawyer?** I put it on the list below and build the simple order meanwhile.
6. **Response window of 7 days, one response, up to 1,000 characters.** Right numbers?
7. **Feedback to the employee:** written by the decider, **required for Extend and Not confirmed**, optional for Confirm, shown only once HR marks the employee told. **Yes.**
8. **The decider must record that they read the response**, and unread responses stay on the digest. **Yes.**
9. **The manager may recommend from 30 days before the end date** (the existing alert window). **Yes.**
10. **Letters are unchanged** (the confirmation letter button only). **Yes.**

## 8. Not in this step

Automatic confirmation, extension, failure, exit or letter; a hearing or appeal procedure; changing the appraisal or its recommendation list; analytics on outcomes; department heads as a data field on the department (designation is a separate list); applying the same pattern to improvement plans or disciplinary actions (that is governance step 2). **For your lawyer:** whether an employee must be heard before a probation is not confirmed, what notice and pay follow, and how long the probation records are kept (the retention schedule, governance step 3).

## 9. Order of work once you say "go"

One pull request with one migration: (1) the pure rules and their unit tests; (2) the integration tests, written to fail; (3) the schema and migration, round-tripped; (4) the review steps and the gate in `decideProbation`; (5) the designation list and the Company Administrator's notice; (6) the contract page (the steps, the policy checks, the history) and the employee's page (feedback and response); (7) the digest, the employee's copy of their data and erasure; (8) docs, the explain-back note and the full suite; (9) browser checks with a manager, HR, a designated decider, the employee and another company, and a report. Estimated size: about the same as the Delegated HR Officer build.
