# Explain-back note: promotion proposals, career paths and succession (career and succession, step 1)

Branch `career-succession`. One migration, `20261204090000_career_and_succession` (additive: two enums, four tables, one HR policy column). This touches **access control** (who may propose, decide and read succession) and **personal data**, and it sits next to pay (a promotion leads to a pay change), so please read it. Built on your "go" of 2026-11-10 to the plan `docs/plans/career-succession-plan.md` (#173). **You did not answer the plan's ten questions, so I used my recommended answers; they are listed under "Assumptions".** **No pay, payroll, payslip, payment file or statutory figure is touched, and nothing in this step changes an employee's role.**

## The rules, step by step

1. **A promotion proposal is a record of a decision.** It says: this employee moves from their current role (employee category) to another, intended from a date, for these reasons, proposed by this person. **Approving it changes nothing**: no category, no pay, no allowance, no deployment. A test compares the employee's role, pay rates, pay-rate proposals, payroll records and arrears before and after approval: identical.
2. **Who proposes whom** is the same rule as for feedback and recognition, reused rather than rewritten: HR about anyone, a manager only about **their own direct reports** (anyone else is "Employee not found"), **nobody about themselves**. The employee, the auditor and finance cannot propose. An employee who has left cannot be proposed; the target must be a different role of this company; the intended date cannot be in the past; and one open proposal per person (proposed or approved-but-not-applied) at a time.
3. **Warnings, never blocks.** When a proposal is made the server records which of these applied, as codes: no career path set for the move, less time in the current role than the path asks, a required course missing or expired, an open improvement plan, an open disciplinary case. **A proposal with warnings is still accepted**; the decider must give a reason (at least five characters) to approve it. Only people who read HR records see the warnings; **a manager who proposed does not**.
4. **Time in the role** is counted from the day the last applied promotion into this role was marked applied, else from the day they joined (there is no earlier record of role changes).
5. **Deciding.** Someone with the approve right (`hr.approve`) who **did not propose it** approves or declines; a decline needs a reason. A decided proposal cannot be decided again. **Approval is refused if the employee's role has changed since the proposal** (so a stale proposal cannot be approved).
6. **Withdrawing.** The proposer may withdraw their own proposal while undecided; after approval only the approve right can. Always with a reason; nothing is deleted.
7. **Applying.** HR (`hr.manage`) marks an approved proposal **Applied**, and the server accepts that **only when the employee's category really is the new one**: HR must first change the role on the employee's record and put the new pay through the existing pay-rate proposal (which keeps its own proposer and approver). This step adds no way to change a role or pay.
8. **Career paths** are the company's own data (Settings > Career paths; none are provided): from a role to another, optionally months asked and a course asked (by its training-requirement name, matched the same way compliance matches it). They guide and warn; they never block.
9. **Succession** is kept only by `succession.manage`, which **only the HR administrator holds** (withheld from the company and super administrators, as for welfare; your decision of 2026-11-10 for sensitive lists). A critical role is a category; up to **five successors** per role, each one entry per person, with a readiness level and an optional one-line reason; never someone already in the role or someone who has left. **Nothing is scored or suggested.** The overview counts the role's holders, those leaving soon (an exit already raised, or a contract ending within 90 days) and says whether anyone is ready now.
10. **What the employee sees** (My career): their role, the paths from it with their own progress (months met? course held?), and their own **approved or applied** promotion. Never a proposal being considered or declined, and never any succession entry.
11. **Personal data and audit.** An approved or applied promotion, with its reason, is in the employee's copy of their data; a proposal still being considered or declined is not; **succession is never included**. On erasure the reason, decision note and withdrawal reason are removed and a successor's one-line reason is cleared; the shape and the audit log stay. **Audit entries carry ids, warning codes and the readiness level only**, never a reason or a note.
12. **HR digest:** an approved promotion not applied for a number of days (HR policy, default 14, 0 = never) is listed under "Approved promotions not yet applied".

## A worked example

The company sets a path "Guard to Supervisor: at least 24 months in the role; course Supervisory skills". Tunde, a guard of 31 months with a valid Supervisory skills certificate and no open plan or case, is proposed by Ngozi (HR) with two sentences and an intended date of 1 January: **no warnings**. The payroll manager (not Ngozi) approves; nothing about Tunde changes, and he sees on **My career** "Approved for Supervisor, intended from 1 Jan". On 1 January Ngozi changes his role to Supervisor on his record, proposes his new pay through the pay-rate proposal (approved by the payroll manager as today) and marks the promotion Applied; the system confirms his role is Supervisor, and his time in role restarts at 0 months. Had Ngozi proposed a guard with 10 months and no course, the proposal would show **two warnings** and the approver would have to type a reason. Had it been declined, Tunde would never have known. Separately, Ngozi names Tunde as a "ready in 1 to 2 years" successor for the Supervisor role: only she can see that.

## What could go wrong, and what proves it does not

| Risk | Test |
| --- | --- |
| Approving changes a role, pay or payroll | `career.test.ts`: role, pay rates, pay-rate proposals, payroll records and arrears identical before and after approval |
| A manager proposes someone who does not report to them, or anyone proposes themselves | `career.test.ts`: "Employee not found" / "You can't propose yourself" |
| The proposer decides their own proposal | `career.test.ts`: refused for approve and for decline |
| A stale proposal is approved after the role changed | `career.test.ts`: refused |
| Marked applied while the role was never changed | `career.test.ts`: refused until the category matches |
| A warning blocks, or is ignored | `career.test.ts` and unit `proposalWarnings`: recorded in a fixed order; approval with a warning needs a reason; none blocks |
| A manager sees the warnings (an open case or plan) | `career.test.ts`: the manager's list has no warnings |
| The employee learns of an undecided or declined proposal | `career.test.ts`: My career shows approved or applied only |
| Anyone but the HR administrator reads or edits succession | `succession.test.ts`: the company and super administrators, the auditor, finance, a manager and the employee are each refused on every call; unit test fails if any other role is given `succession.manage` |
| Succession leaks through the timeline, the data copy, the audit log | `succession.test.ts`: absent from the timeline and the copy of their data (successor and holder), the audit log carries no reason |
| A reason survives erasure, or erasure touches someone else | `career.test.ts` and `succession.test.ts`: words removed, shape and audit kept, others untouched |
| Another company reads or changes anything | `career.test.ts` and `succession.test.ts`: "not found" / empty |
| The migration loses data | round trip (up, down, up) on a copy of the seeded database: counts unchanged, schema identical |

## Assumptions (my recommended answers to the plan's questions; change any of them)

1. A **category is the unit of role** (no job title or grade yet). 2. Career paths **warn, never block**. 3. A **manager may propose for direct reports**, HR decides. 4. The person who decides **may also apply** it (HR applies on screens that keep their own pay approvals); only the proposer cannot decide. 5. **`succession.manage` is the HR administrator alone.** 6. **The auditor does not read succession** (they read proposals, like other HR records). 7. **Succession is not in the employee's copy of their data** (a lawyer should confirm). 8. An open plan or case **warns and needs a reason**, never blocks. 9. **Five successors and three readiness levels.** 10. **No transfers** between clients or sites.

Smaller choices you did not ask for: **a critical role is a whole category** (the plan said "a category, or a category at one client": the client-level version is not built); **a successor cannot already be in the role**; **time in the role restarts at an applied promotion** (there is no earlier role history); **the company and super administrators hold `career.propose`** (they hold everything else) but not `succession.manage`; **a company with no HR administrator cannot keep a succession list**.

## What I did not do or test

- The wording shown to employees about promotion and how long proposals and succession entries are kept are **for a lawyer to review**.
- **Not built:** skills matrices, scoring of potential, automatic suggestions, salary bands and grades, internal job postings, mentoring plans, transfers, a critical role at one client only.
- Browser checks are reported in the task report (what was seen on screen and what was not).
