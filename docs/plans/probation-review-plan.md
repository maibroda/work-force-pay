# Performance management, step (d): the probation review and its decision

Written 2026-11-09. **A proposal only: nothing is built and no migration is written until the founder answers the questions in section 6 and says "go".** It is item 4(d) in the build order of `docs/plans/founder-decisions-2026-11-05.md` (job descriptions and KPIs #157, the improvement plan #164 and continuous feedback #166 are built). **Most of the probation review already exists**, so this plan is about the gaps, not a rebuild (CLAUDE.md rule 1: extend what exists). It changes how a decision about someone's employment is made and recorded, so it touches approvals and the audit trail and needs your "go". I have assumed no Nigerian employment-law rule; where a rule is a legal question I say so and ask.

## 1. What exists today (checked in the code on 2026-11-09)

- **The decision** (`decideProbation` in `src/server/services/contracts.ts`, needs `hr.approve`): **Confirm** (the probationary contract is superseded by a permanent one from a chosen date), **Extend** (by 1 to 12 months, never beyond the company's longest probation, counted on the contract) or **Fail**. A reason of a few words is required for Extend and Fail.
- **The appraisal link** (`src/server/services/appraisals.ts`): HR can **start a one-person probation appraisal from the contract** (`startProbationAppraisal`, period = the probation); the HR policy can **require a signed-off probation appraisal before confirmation** and a **minimum score** (`probationRequiresAppraisal`, `probationMinScore`); both are checked on Confirm (`assertProbationAppraisalAllows`).
- **Reminders:** the HR digest lists probations ending within the alert window (`probationAlertDays`) and past their end date ("overdue"), with where the probation appraisal stands ("no probation appraisal yet", "in progress", "awaiting sign-off", "signed off").
- **Letters:** a **Probation confirmation** letter type exists; HR makes it from the employee's profile once a probation is confirmed.
- **The appraisal's own recommendation** ("Confirm employment" among others) is recorded but starts nothing, correctly: a score must not trigger a decision.

## 2. The gaps this step closes

1. **The decision is not a structured record.** The reason is appended to the contract's free-text notes; who decided and when exist only in the audit log; **which appraisal supported it, its score and its recommendation are not stored**. A year later HR cannot see "confirmed on 3 March by X, against a probation appraisal of 3.8 that recommended confirmation".
2. **Nothing flags a decision against the appraisal.** Confirming someone whose appraisal recommended a plan or training, or failing someone whose appraisal recommended confirmation, looks like any other decision.
3. **One person can both rate and decide.** The decision needs `hr.approve`, but nothing stops the person who reviewed or signed off the probation appraisal from also making the decision on it.
4. **A failed probation leaves the employee active with no next step.** The outcome is recorded; nothing prompts an exit, and the digest stops listing the contract.
5. **A probation that ends with no decision** only shows as "overdue" in the digest, with no escalation.
6. **The confirmation letter is a separate, manual step** after the decision.
7. **The employee cannot see the decision** (they see their own appraisal, not what was decided about their probation).

## 3. What the step adds (each is small; all are proposals until you answer section 6)

1. **A decision history** (append-only): each Confirm, Extend or Fail is a row: **who, when, the decision, the note, the extension months or the confirmation date, and a snapshot of the supporting appraisal** (its id, score and recommendation at the time). The free-text note on the contract keeps being written as today, so nothing existing changes.
2. **A decision against the appraisal needs a fuller reason** (for example at least 20 characters, and it is marked "against the appraisal's recommendation" on the history): Confirm when the appraisal recommended something else, or Fail when it recommended Confirm. It is **never blocked**: HR may decide against it, but has to say why.
3. **The decider is a second person:** the person who decides must **not be the reviewer or the approver of the probation appraisal** they are deciding on (enforced on the server, as for appraisals and plans). If the company has no probation appraisal for this contract (the policy does not require one), the rule does not apply.
4. **After Fail, the contract page and the digest say "No exit started"** until an exit is raised, with a button to start one from the existing Exits process (never automatic: the exit has its own approvals, notice and settlement rules, and what a company owes on a failed probation is a legal and contractual question).
5. **A probation past its end with no decision is escalated in steps:** it appears in the digest as overdue with the number of days; after a number of days set in the HR policy (proposed **7**) it also appears in the **company administrator's** approvals list. (Settings, not code.)
6. **A "Generate confirmation letter" button** appears on the confirmed contract, using the existing letter. No letter is generated automatically and no letter is added for Extend or Fail (wording is a legal matter).
7. **The employee sees the outcome** on **My employment** (a short line, not the reasons): "Probation confirmed on 3 March", "Probation extended to 3 June", or "Probation not confirmed" (question 6).

## 4. Files, migration, permissions and tests (once approved)

- **Migration (additive, reversible, round-tripped on a copy of the seeded database):** one table, `ProbationDecision`; one HR policy column (days before an undecided probation is escalated). No existing column changes meaning.
- **Pure functions first** (`src/lib/probation.ts`): whether a decision departs from the appraisal's recommendation, the minimum reason length for it, whether a person may decide (not the appraisal's reviewer or approver), the escalation day count. **Unit tests first.**
- **Extend, do not duplicate:** the rules go inside `decideProbation` and `startProbationAppraisal`'s neighbours; no second decision path. The contract page shows the history and the new buttons.
- **Permissions:** no new permission: the decision stays `hr.approve`; reading the history needs `hr.view` (as the contract page does today). The employee's line needs only a login.
- **Tests (integration, written first):** each decision writes one history row with the snapshot; an existing contract flow (confirm to permanent, extend within the longest, fail) is unchanged; a decision against the recommendation needs the fuller reason and is marked; the appraisal's reviewer and approver cannot decide; a decision with no probation appraisal (policy off) is unaffected; the escalation lists the company administrator only after the set days and only for that company; the employee sees only their own outcome, not the reasons; another company sees nothing; the audit log carries ids and the decision, never the note; roles without the right are refused.
- **Personal-data rules (learned from the improvement plan):** the decision note is personal text, so it is added to **the employee's copy of their data** and **removed on erasure** (the shape, the decision and the dates stay), with tests, in the same change.
- **Documents:** release notes, the data dictionary (regenerated), an explain-back note (approvals and the decision record: worked example with a confirmation and one against the recommendation).

## 5. What is not in this step

Any automatic confirmation, extension, failure, exit or letter; a probation review form separate from the existing appraisal; analytics on probation outcomes; changing the appraisal's recommendation list; and any statement of what the law or a contract requires on a failed probation.

## 6. Questions for the founder (my recommendation in bold)

1. **A second person decides:** the decider must not be the reviewer or approver of the probation appraisal. **Yes.**
2. **A decision against the appraisal's recommendation** is allowed but needs a fuller reason (about 20 characters) and is marked. **Yes**; or would you rather block it without a company administrator's approval?
3. **After Fail:** only a prompt and a button to start an exit (no automatic exit). **Yes.** Is there a rule you want shown on screen (for example a notice period for a failed probation)? That is for your lawyer; I will not state one.
4. **Escalation of an undecided probation:** after **7 days** past the end date it also appears in the company administrator's approvals. Right number, and right person?
5. **Early confirmation:** today a probation can be confirmed before its end date. **Keep allowing it** (with the effective date chosen by HR), or require the end date to have been reached?
6. **What the employee sees:** the outcome line only (confirmed / extended to a date / not confirmed), **not the reasons**. Is "Probation not confirmed" acceptable to show before HR has spoken to the employee? **I suggest showing the line only once HR marks the person as told.**
7. **Letters:** a button for the confirmation letter only. **Yes.**

## 7. Suggested order of work once you say "go"

One pull request with one small migration: (1) the pure rules and their unit tests, (2) the schema and migration, (3) the changes to `decideProbation`, the history and the escalation, with integration tests, (4) the contract page, the digest lines and the employee's line, (5) the data-copy and erasure coverage, (6) docs, the explain-back note and the full suite, (7) browser checks with HR, a second approver, the employee and another company, and a report.
