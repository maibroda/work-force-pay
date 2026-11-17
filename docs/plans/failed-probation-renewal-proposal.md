# Failed-probation renewal: configurable parameters and approval workflow (a proposal)

Written 2026-11-14. **Status: approved on 2026-11-17 (F1 to F4 as recommended; F5, the wording of the statement, left for the lawyer, so the statement is plain and flagged as unreviewed) and built on branch `probation-reconsideration`: see `failed-probation-reconsideration-explain-back.md`.** It was first a proposal only: **no code was written until the founder approved these parameters and this workflow.** The founder's rule (2026-11-14): **an employee who fails probation may still be considered for renewal, but never automatically.** Renewal must have: a **documented justification from the supervisor**; **HR review and approval by the designated authority**; the **extension period and a revised review date**; **measurable performance-improvement expectations**; **formal communication to the employee**; a **complete audit trail**.

## 1. What exists today (verified in the code)

- A probation ends in one outcome on the contract: confirmed, **failed** or extended (`ProbationOutcome`), recorded with who, when and why in an append-only `ProbationDecision` history, with the optional **probation workflow** (manager recommends, a different HR person reviews, an independent designated decider decides, the employee gets written feedback and one response; `ProbationReview`, `ProbationDecider`).
- Policy settings already exist: `defaultProbationMonths` (3), **`maxProbationMonths` (6)**, `probationAlertDays` (30), `probationEscalationDays` (7), `probationWorkflow` (off by default), `probationResponseDays` (7), `probationRequiresAppraisal`.
- **Step 4 closed the bypass for an undecided probation** (renewing needs a decision first). **A probation already recorded as failed can still be followed by an ordinary contract renewal**, which is the gap this rule replaces with a controlled path. Today a failed probation also leaves the employee on payroll until an exit is started (the contract page says so).
- Extending a probation already exists as a decision (`EXTENDED`, with a month count and a new end date); a failed probation cannot be extended because the outcome is final.

## 2. Proposed behaviour: a "reconsideration" of a failed probation

A failed probation stays **recorded as failed** (the history is never edited). A **reconsideration** is a new, separately approved step that, if approved, **extends the probation** with conditions. It is not an edit of the failed decision and not a renewal of the contract.

### Workflow (every step is a different person where the rights allow, as in the probation workflow)

1. **Request** (the supervisor or reporting manager): written **justification** and a proposed **extension period**, only within the **reconsideration window** after the failed decision.
2. **Improvement plan** (the supervisor, with the request): at least one **measurable expectation**, each with what is measured, the target and the date it is reviewed.
3. **HR review** (an HR administrator who is not the requester): confirms the justification and expectations are complete and reasonable; may send back or decline with a reason.
4. **Approval** (the **designated authority**, the same independent decider mechanism as the probation workflow: the Company Administrator or a designated person, never the requester or the HR reviewer): approves, declines with a reason, or approves a different period within the limits.
5. **Communication to the employee**: a written statement of the decision, the conditions and the review date is recorded as given to the employee; the employee may respond once (as today). **Until it is recorded as communicated, the extension does not take effect.**
6. **Revised review date**: the probation end date moves to the approved date; the normal probation reminders, escalation and the decision (confirm, extend again within limits, or fail) apply from there.
7. **If declined, or the window lapses:** nothing changes; the failed outcome stands and the exit process applies as it does today (the system never exits anyone by itself).

**Never automatic:** no timer, score or rule approves a reconsideration. **Audit:** every step records who, when and why (ids and the step, never the comment text), and the decision history keeps the original failure and the reconsideration side by side.

## 3. Configurable policy parameters (proposed, with defaults)

| Parameter | Proposed default | Notes |
| --- | --- | --- |
| Reconsideration enabled | **Off** | A company switches it on, as with the probation workflow. |
| Reconsideration window (days after the failed decision) | **14** | After this, a reconsideration cannot be requested. |
| Minimum / maximum extension (months) | **1 / the company's `maxProbationMonths`** | The total probation (original plus extensions) may not exceed a company ceiling (a new setting, proposed **9 months**). A lawyer should confirm what the law allows. |
| Maximum reconsiderations per contract | **1** | A second failure is final. |
| Minimum justification length (characters) | **50** | Prevents a one-line reason. |
| Minimum number of measurable expectations | **1** | Each with a measure, a target and a review date. |
| Who may request | **Reporting manager or supervisor** | As the probation recommendation. |
| Approval authority | **Company Administrator or a designated decider** | The existing probation deciders list. |
| Employee response window (days) | **The existing `probationResponseDays` (7)** | Reuses the existing response. |

## 4. Questions the founder must settle before any code

1. **Who may ask for a reconsideration**, only the supervisor, or may HR or the employee? (Proposed: supervisor only.)
2. **The reconsideration window** and **the maximum total probation**: 14 days and 9 months are my proposals; **the legal ceiling is for the company's lawyer.**
3. **May a reconsideration be approved by the same designated authority that confirmed the failure**, or must it be a different person? (Proposed: the same independent-decider rules as today, never the requester or the HR reviewer.)
4. **What happens to pay and status during the reconsideration?** Today a failed-probation employee stays on payroll until an exit is started; proposed: **no change to pay or status**, and nothing about pay is touched by this rule.
5. **The wording of the written communication to the employee** (for the lawyer).

## 5. How it would be built once approved (for the record, not started)

One pull request: a small additive, reversible migration (a reconsideration record linking to the failed decision, the expectations, the settings); tests first (the whole workflow, the second-person rules, the window and limits, that nothing is automatic, that an ordinary renewal of a failed probation is refused, tenant isolation, audit by ids); screens on the contract page; an explain-back note. **The ordinary `renewContract` path would also be closed for a failed probation** so the only way back is the controlled reconsideration. Nothing in this proposal changes pay, statutory settings or existing decisions.
