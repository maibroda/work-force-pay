# Plan: the late-approved public-holiday shift, corrected through the next open payroll

For the founder to read and say "go" to, one piece at a time. **Nothing here is built.** Written 2026-11-22, after #268 to #271 were opened. It turns item E of your brief into pieces. As always: tests first, a reversible migration for any new table, an explain-back note and a pull request for each piece, and **nothing is merged without your explicit approval**.

## 1. What you decided (recorded)

When a public-holiday shift is approved **after payroll already classified or paid that day as not worked**:

- correct it through the **next open payroll**; the original closed payroll and its payment records are never touched;
- work out the **corrected entitlement**, deduct what was **already paid**, and pay or recover **only the net difference**;
- link the adjustment to the **original shift, its approval and the original payroll line**;
- require documented **supervisor approval** and a **payroll review**;
- **prevent duplicate adjustments**; keep a **full audit trail** (original classification, reason, approver, calculation, payment);
- if the next payroll is **closed**, **escalate** for an authorised alternative rather than changing a closed payroll silently;
- a shortfall (corrected pay less than what was paid) is recovered as a **deduction within the existing 33.33% cap**, the remainder **carried forward**, after payroll review.

## 2. What exists today (so I reuse it and build nothing twice)

| Piece | What it does today | What it means for this plan |
|---|---|---|
| **#268 (open, CI passed)** | When a late shift on a holiday already paid as not worked is paid by a supplementary payroll, one critical finding says the day was paid twice. **No money is moved.** | The safeguard until this plan is built; this plan replaces the "tell Payroll to deduct by hand" step. |
| **Late hours (H22)** | A shift approved after the lock is paid in full by a supplementary payroll for that period, once. | The shift on a paid holiday must **not** also be paid here; the adjustment settles it (see section 4, piece D). |
| **Supervisor approval of shifts** | Every shift is approved by a supervisor (never the person who captured it): documented, with who and when. | This **is** the documented supervisor approval of the shift (question 1). |
| **One-off deductions** | A deduction is requested and approved for ONE period, with an authority reference; the payroll warns when deductions pass the cap, it does not limit them. | Not enough on its own: no carry-forward and the cap is only a warning. |
| **Loan book** | Recoveries are scheduled, cut to keep take-home above a floor, and the part not taken is carried forward. | The model for carry-forward; I do not want to force an overpayment through the loan book (no money was lent). |
| **Period states** | A period is open, locked or closed; supplementary payrolls correct locked ones. | "Next open payroll" = the earliest period after the original one that is still open. |

## 3. What I propose

A new record, the **holiday adjustment**, one per person and holiday date (a unique key, so it can never be made twice):

1. **Created automatically** when a shift is approved on a day that a payroll already paid as a holiday not worked. It stores: the person, the holiday date, the **shift** and **who approved it and when**, the **original payroll run and stored line** and what it paid, the **original classification** ("holiday not worked"), the **corrected entitlement** (the hours worked that day at the holiday rate, as any worked holiday is paid), and the **net difference** (corrected less paid, which can be positive, zero or negative). All amounts in whole kobo, rounded half up once.
2. **Review:** a payroll reviewer **who did not approve the shift** reviews it (approve or reject, with a reason). Until approved it changes no pay.
3. **Applied in the next open payroll**, once: a **positive** net is paid as an earning line there (taxed and counted for pension like the hours, split by the site's salary structure, shown on the payslip as "Holiday adjustment (date)"); a **negative** net becomes a **recovery** (below). If there is **no open period after the original one**, the adjustment is **escalated**: a critical finding in the payroll dashboard and a notice to the finance director and you; **nothing in the closed payroll changes**; it waits for an authorised alternative (for example opening the next period).
4. **Recovery within the cap, carried forward:** each payroll takes up to the cap (33.33% of that payroll's gross earnings, less other deductions already in it) and records the part still owed; the next open payroll takes the rest, until nothing remains. The balance is held on the adjustment (not a loan), every cut is audited, and the person can see it on their payslip as "Recovery of holiday adjustment (date)". A person who **leaves** with a balance owing goes to the end-of-service settlement (the same as the loan book).
5. **Audit:** every step (created, reviewed, applied, cut, completed, escalated) is a stored audit entry with ids and numbers only; the original payroll and its payment records are untouched.
6. **The #268 finding stays** as the fallback for any case this does not cover, and says so.

## 4. The pieces, in order (each its own pull request, off until you turn it on)

| # | Piece | Data | Size |
|---|---|---|---|
| **A** | The adjustment record, created when the shift is approved, with the corrected entitlement, the review by a second person and the audit; **no pay yet** | one table (reversible) | medium |
| **B** | A positive net applied in the next open payroll as an earning line; the escalation when there is no open payroll | none beyond A (one line kind) | medium |
| **C** | A negative net recovered within the cap, carried forward, shown on the payslip, finished on exit through the settlement | a balance on the record, recovery lines | large |
| **D** | The late shift on a paid holiday is **left out of the supplementary payroll's own pay** (the adjustment settles it), so it is never paid twice and #268's finding is reserved for what is not covered | none | small, but it changes the pay of a late shift: needs your explicit "go" |

A, B and D can be one pull request if you prefer; C is the one that moves money out of a person's pay and should be reviewed alone.

## 5. Questions for you (with my default if you say "your choice")

1. **Is the supervisor's approval of the shift enough as the "documented supervisor approval",** with the payroll review by a different person? **Default: yes.** Alternative: a second, separate supervisor confirmation of the adjustment itself.
2. **The corrected entitlement = the hours worked that day at the holiday rate** (how a worked holiday is paid anywhere else). **Default: yes.**
3. **The cap for recoveries:** total deductions in a payroll may not exceed 33.33% of that payroll's gross earnings, the rest carried forward. **Default: yes**, using your existing setting (today only a warning) as a real limit for these recoveries only.
4. **A positive net** (they are owed more) is paid as earnings in the next open payroll. **Default: yes.**
5. **Who reviews:** the payroll checker role (never the person who approved the shift, never the person it concerns). **Default: yes.**
6. **If the person has left** before the next payroll: the adjustment goes to the end-of-service settlement. **Default: yes.**
7. **Do you want the legal and payroll-tax adviser to see this too?** It recovers pay from an employee, so I recommend yes: add it to the list of reviews in item 5 of your brief (deductions from wages are regulated). **Recovery (piece C) should not be switched on in production before that review is recorded.**

## 6. Not in this plan

Other kinds of correction after payment (a rate corrected, a shift moved to another day), approving the correction by the person it concerns, and anything in the legal review itself.
