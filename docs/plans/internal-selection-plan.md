# Internal applicants: what "selected" means (recruitment slice B, part 2): a proposal for your decision

Written 2026-11-17, answering the question left open in `recruitment-internal-explain-back.md` ("What should 'selected' mean for an internal applicant?"). **Status: approved on 2026-11-17 (S1 to S3, S5 and S6 as recommended; S4 left with HR as today; S7 as a separate fix) and built on branch `internal-move`: see `internal-selection-explain-back.md`.** It was first written as a proposal only, because it touches roles and, indirectly, pay.

## 1. Where things stand (checked in the code on 2026-11-17)

- An employee can apply to a published vacancy; only HR and the interview panel see the application; the applicant's own manager is told nothing by the system. That is built and merged.
- **The existing hire is refused for an internal applicant** (it would create a second employee record for a current employee). So today an internal applicant can be interviewed, scored and recommended, but **cannot be "selected" into anything**: the process stops.
- **A promotion process already exists** (career): someone proposes a move to another **role** (an employee category), **a different HR person approves** (never the proposer; a reason is needed if the system warned about length of service, a missing course or an open flag), HR then **changes the role on the existing screens** and marks it applied. **It changes no category and no pay by itself.** An employee sees a promotion only once it is **approved or applied**, never while it is still being considered.
- A requisition already carries the **role** (category) the vacancy is for.
- **The promotion process only handles a change of role.** It refuses a move to the same role, so a **lateral move** (same role, another department, site or line manager) has no process.

## 2. What I propose

**Selection of an internal applicant starts a promotion proposal, and nothing else.**

1. An internal applicant is recommended and the selection is approved, exactly as for any candidate (slice A: a different person approves).
2. From the candidate's page, HR (the right to assess candidates **and** the right to propose promotions) chooses **"Start the move"**. This **creates a promotion proposal** for that employee, to the **requisition's role**, with an **intended date** HR enters (not in the past) and **a reason HR writes** (the interview feedback, scores and recommendation are **never copied** into it). The proposal is linked to the candidate.
3. The **existing promotion rules apply unchanged**: a different HR person approves; the length-of-service, course and open-flag warnings are shown and need a written reason to approve; the employee, and their manager, are **told nothing by the system**; the employee sees it only once approved.
4. HR **changes the role and the pay on the existing screens** (with their own controls and approvals), then marks the promotion applied. **This slice never sets or changes pay, a contract or a salary structure.** When it is applied, the candidate shows **"moved internally on [date]"** and the vacancy counts it as **one position filled** (so a vacancy for two posts can be part filled by an internal move and part by an outside hire).
5. Unsuccessful internal applicants are closed through the existing rejection step; **the system tells nobody**; HR tells them.

**What it needs:** one **additive, reversible** migration (one optional column linking a promotion proposal to the candidate), no new right, a small service, and a button and a line on the candidate page. Tests first, as always: the proposal is created for the right employee and role; nothing from the interviews is copied; the existing approval, second-person and warning rules still apply; nothing is shown to the manager or the employee early; headcount counts the move once; the external hire is unchanged.

## 3. What I am deliberately not building

- **No pay.** The new pay, any contract change and the date the new pay starts follow your **existing pay and contract screens**, which are critical modules with their own checks. The proposal does not carry the requisition's private budget.
- **No lateral moves** in this slice (see question S2).
- **No job offer for an internal applicant** (question S3).
- **No message to anyone** (the applicant's manager, the applicant or the other applicants).

## 4. Questions for you (my recommendation first; none is assumed)

- **S1. What "selected" means.** *Recommended:* a **promotion proposal through the existing process** as in section 2. *Alternative:* HR closes the requisition and records the move by hand, with no link and nothing for the system to check.
- **S2. A lateral move (same role, another department, site or manager).** *Recommended:* **not in this slice.** HR records it on the existing employee screens and marks the candidate "moved" with a one-line reason. *Alternative:* extend the promotion process to allow a same-role move with a changed department (more code in a critical area, and a new rule for you to approve).
- **S3. Does an internal applicant get a job offer?** *Recommended:* **no.** An offer is a new-hire letter with pay terms; for an internal move the **approved promotion replaces it**, and HR gives the employee their new terms through the existing letter. This also means the earlier exception (an approver sees an internal applicant once an offer exists) **never arises**, so I would **remove it** (an approver of the promotion sees the person through the promotion). *Alternative:* allow an offer, with the pay terms in it.
- **S4. Pay and the date.** *Recommended:* the proposal's **intended date** is when the role should change; HR must make the **pay change on the same date** through the existing screens. A change in the middle of a payroll month is **a question for you**: how should a mid-month promotion be paid (the old rate to the change date and the new rate after, or from the next month)? I have **not assumed an answer**; today the process leaves it to HR. **Answered by the founder on 2026-11-19: the old rate to the day before the change and the new rate from the change date.** Payroll already does this for a person on a personal pay rate when HR enters the new rate with the change date as its start date (proved by `tests/integration/mid-month-pay-rate.test.ts`, no pay code changed; see `mid-month-pay-rate-explain-back.md`). Not built: the promotion creating the pay rate itself.
- **S5. Who may start the move.** *Recommended:* the **HR administrator only** (it needs the right to assess candidates and the right to propose promotions, which only HR holds together). The approver is a different holder of the approve right, as for any promotion.
- **S6. Counting.** *Recommended:* an internal move counts as **"filled" but not as an external "hire"** in any recruitment figure, so hiring numbers stay about new people.
- **S7. The audit log and the requisition's private justification (from the earlier note).** *Recommended:* **stop writing the justification's words into the audit log** (ids and field names only, as for everything else), as a **small separate fix**. Existing audit rows are append-only and stay. This does not depend on the answers above.

## 5. Risks

- **Pay can lag the role.** If HR approves the role change but the pay is changed late, an employee is in a new role on old pay. The existing digest already flags an approved promotion not applied after 14 days; nothing in this slice makes that worse, and nothing here fixes it.
- **The employee's own manager learns of the move only from HR.** The system tells nobody, so HR must tell the manager at the right moment (after the decision, before the role changes); nothing prompts HR to do so.
- **A candidate with an open promotion proposal already** cannot be started a second (existing rule): HR must resolve the first.

## 6. What I need from you

1. **Answers to S1 to S6** (or "as recommended"), and whether to do **S7** as its own small fix.
2. Your **"go"**. Then I build it as one PR (one small migration, tests first, explain-back note), and wait for "merge #N".
