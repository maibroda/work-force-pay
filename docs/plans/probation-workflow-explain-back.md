# Explain-back note: the probation workflow

For the founder. Plain language, payroll vocabulary. Plan: `probation-workflow-plan.md` (#186). **This changes who may decide something about a person's employment and what the employee is told, so it touches approvals and access control: please read it.** Built on your "go"; **you did not answer the plan's ten questions, so I used my recommended answers (listed at the end)**.

## What the code does, step by step

1. **It is switched off by default.** A new HR policy setting ("probation is decided through a recommendation, an HR review and an independent decision") is off. While it is off nothing changes: HR's approver decides probation exactly as before, with the same rules.
2. **When it is on, the old direct decision refuses.** `decideProbation` now says to use the review. The contract's probation outcome still changes in **one** place only: the same decision logic, now shared (`applyProbationDecision`), so Confirm, Extend and Fail work exactly as they did, and the decision record, the appraisal snapshot and the "against the appraisal" rule are unchanged.
3. **Step 1, the manager recommends** (My Workspace › My team's probation): confirm, extend (with months) or do not confirm, with reasons of at least 20 characters, only for **their own direct report**, never for themselves, from 30 days before the end date (the existing alert window). HR may record it **only where the employee has no reporting manager**, and it is marked "recorded by HR". One open recommendation at a time.
4. **Step 2, a different HR person reviews** (on the contract page): forward to the decider or return to the manager, with a note. The review records what the policy checks showed (signed-off appraisal, minimum score, within the longest probation). The person who recorded the recommendation cannot review it. **Return** leaves the round exactly as it was; the manager's next recommendation is round 2.
5. **Step 3, an independent decider decides** (My Workspace › Probation). Only a **designated decider**: the Company Administrator (and platform staff) always, or a user the Company Administrator designated under Settings › Probation deciders, for one department or for all. **Never** the recommender, the HR reviewer, the probation appraisal's reviewer or signer, or the employee, even if designated. **The HR administrator cannot decide, and cannot designate.** A decision that is not the one the manager recommended needs a fuller reason (20 characters) and is marked, but is never blocked. The review is completed in **the same transaction** as the contract change: both happen or neither does.
6. **Step 4, written feedback.** The decider writes a statement for the employee (up to 1,000 characters): **required to extend or not confirm, optional to confirm**. It is separate from the internal reason. The employee sees it only once HR marks them told (the existing button).
7. **Step 5, one response.** The employee may agree or disagree once (disagreeing needs a sentence), within the company's window (HR policy, default **7 days**, counted from the day HR told them; **0 = no time limit**, my reading of the plan's "0 = no window"). **A response changes nothing by itself**: no reversal, no exit. A change of mind is a new, reasoned decision. The decider records that they **read** it; unread responses stay in their queue.
8. **After "not confirmed", nothing else happens by itself** (the existing prompt and link to Exits remain).
9. **Audit:** each step writes an entry by ids and the step; **never the notes, the feedback or the response**. **Personal data:** the notes, feedback and response are in the employee's copy of their data and are **removed on erasure** (the shape stays).

## A worked example

Ada is the Company Administrator; Obi and Zainab are HR; Tunde supervises Gbenga, whose three-month probation ends on 20 December. On 25 November Tunde recommends **Confirm** ("on time every shift and the client asked for him by name"). Obi reviews it and forwards it (appraisal not required by policy, within the longest probation). **Obi cannot decide, and nor can Tunde**; Ada designates Mrs Okafor, head of Operations, as a decider for her department. Mrs Okafor decides **Confirm** and writes feedback: "You met the standard and we are confirming you." The contract becomes permanent from 21 December in the same step. Zainab marks Gbenga as told on 22 December; he reads the feedback and, within seven days, responds "I agree". Mrs Okafor marks the response read. Had Mrs Okafor decided **not to confirm** instead, she would have given a reason of at least 20 characters (it differs from the recommendation) and written feedback for Gbenga; no exit would start.

## What could go wrong, and which test proves it does not

| Risk | Test (`tests/integration/probation-workflow.test.ts`, `tests/unit/probation-workflow.test.ts`) |
| --- | --- |
| The new flow changes a company's current process | "the policy switch": off by default, the HR approver decides as before |
| The old direct path bypasses the independent decision | "when on, the old direct decision refuses" |
| Someone recommends for a person who does not report to them, or for themselves | step 1 tests: another manager gets "not found", the employee is refused, nobody for their own probation |
| HR reviews their own recommendation, or decides | step 2 and 3 tests: the recorder cannot review; HR cannot decide |
| The decider is someone in the chain | step 3: the recommender, the HR reviewer and the employee are refused even when designated |
| A designation outlives its purpose | the department-head test: scoped to a department, revoked takes effect at once |
| A decision and its review get out of step | the decision test checks the contract, the decision row, the link and the review together |
| The employee sees internal reasons or hears too early | step 4 and 5 tests: nothing until told; then only the decision and the feedback, never the notes |
| A second or late response | one response only; the window closes after the company's days; 0 means no limit |
| The audit log carries text | the audit test searches every probation entry for the notes, feedback and response |
| Text survives an erasure | the privacy test: the data copy holds the texts; erasure removes them and keeps the shape |
| Another company's people act or see | the tenant-isolation test |

## Assumptions (my recommended answers to the plan's ten questions; change any of them)

1. Behind a switch that defaults off. 2. Deciders: the Company Administrator plus designated users (optionally per department). 3. A different HR person does the review. 4. No reporting manager: HR records it, marked. 5. The decision takes effect when made; the employee then receives feedback and may respond; a response never reverses it by itself (**whether an employee must be heard before a decision is a question for your lawyer**). 6. Seven days to respond, once, up to 1,000 characters; **0 means no time limit**. 7. Feedback required to extend or not confirm. 8. The decider must record that they read the response. 9. The manager recommends from 30 days before the end. 10. Letters unchanged.

## What I did not do or test

- **Not built:** a digest line for unread responses (the decider sees them under My Workspace › Probation); automatic confirmation, extension, exit or letter; a hearing or appeal procedure; the same pattern for improvement plans or disciplinary actions (governance step 2).
- **Behaviour you should know:** the existing audit entries `PROBATION_CONFIRM`, `PROBATION_EXTEND` and `PROBATION_FAIL` still carry the decision's reason text (as before this change); the new `PROBATION_REVIEW_*` entries do not.
- **A company with only one person who could decide** (one administrator who is also the HR reviewer) is stuck by design until it designates someone; nothing bypasses the separation.
- **Checked in a browser** against the demo company: see the release notes entry and the report. Anything not listed there was not checked on screen.
