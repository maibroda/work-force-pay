# Plan: piece C, recovering an overpayment of holiday pay from later pay

For the founder to read and say "go" to, one piece at a time. **Nothing here is built, and no code, migration or setting has been changed.** The founder answered the eight questions in section 5 with "use your defaults" on 2026-11-23; the plan is otherwise unchanged and **no piece is started until he says "go" to it.** Written 2026-11-23, after pieces A, B and D were merged (#272, #274). It follows `hourly-holiday-adjustment-plan.md` (section 3, point 4) and your decision of 2026-11-21: *if the corrected pay is less than what was already paid, recover the difference as a deduction in the next open payroll, within the existing 33.33% cap, carry the remainder forward, after payroll review.* As always: tests first, a reversible migration, an explain-back note, one pull request at a time, **no merge without your explicit approval**.

**This takes money out of a person's pay. It must not be switched on for a production company until the legal and payroll-tax review of deductions from wages (item P6 of `docs/legal-review/hourly-payroll-policies-review.md`) is recorded.** The build can be finished and merged with the switch OFF; the review gates the switch, not the code.

## 1. Where things stand today

- A holiday adjustment whose net difference is **negative** (the shift is worth less than was paid as "not worked", for example a 2-hour shift on a day paid 8,000.00 as not worked: owed 4,000.00, net -4,000.00) is reviewed and **approved** like any other. Then **nothing happens**: it stays approved, nothing is taken, the late shift stays held out of supplementary payrolls, and the regular payroll of the earliest open period after the original one raises a critical finding, "recovering an overpayment is not available yet; enter a deduction by hand" (later payrolls do not repeat it, so it is easy to miss).
- That is safe but leaves the person overpaid and the shift unpaid by anyone, until someone enters a deduction by hand.

## 2. What already exists (so I reuse it and build nothing twice)

| What | How it works today | What it means here |
|---|---|---|
| **The 33.33% setting** (`maxDeductionPctOfGross` on the payroll rule) | A **warning only**: the payroll validation says "other deductions exceed 33.33% of earnings". It limits nothing. | It is **not** a real cap today. Your decision says "within the existing cap", so it has to become a real limit **for this recovery**. |
| **The take-home floor** (`minTakeHomePctOfGross`, default 0) | A **real** limit, but a different one: net pay is not taken below a share of gross. It applies **only** to loan and salary-advance recoveries (`CAPPABLE_DEDUCTIONS`); what is not taken is "deferred" and the loan book carries it forward. | Related, not the same measure. I do not want to bend it: loan recoveries and this recovery would then share one limit in a way nobody agreed. |
| **Approved deductions** | A deduction needs an **authority reference** (the engine refuses one without it) and is taken in full unless it is a loan or advance cut by the floor. | A recovery can ride on this: the **approved adjustment is the authority**. |
| **Loan book** | Schedules recoveries, cuts them to the floor, carries the rest forward on the loan. | The model for "carry forward". I would not put an overpayment through it: no money was lent. |
| **Exit settlement** | An exiting person's final amounts, reviewed and approved (preparer is not approver), then released into a payroll as approved **other earnings and deductions**; **manual lines** such as a loan recovery survive a recompute. | The place for any balance still owed when someone leaves. |
| **Pieces A, B, D (merged)** | The adjustment record and its review; a positive net paid once in the next open payroll; the late shift held back; escalation with no open period. | C extends the same record: it uses the same review, the same "next open payroll", the same audit. |

## 3. What I propose

**A real cap, only for this recovery.** In each regular payroll the recovery takes **the smaller of what is still owed and the room under the cap**, where:

- the cap is **33.33% of that payroll's total earnings** (your existing setting, now enforced for this recovery), rounded half up to the kobo once;
- the room is that cap **less the other deductions already in that payroll** (so the cap is the same measure as the existing warning: total other deductions as a share of earnings);
- and never more than leaves **net pay at zero or above** after PAYE, pension and NHF (a recovery can never make net pay negative).

The part not taken stays owed and is tried again in the **next** open payroll. Every payroll that takes a cut is **audited**, and the person's payslip shows **"Recovery of holiday adjustment (date)"** with the amount taken and the balance still owed.

**On the record (extends the holiday adjustment):**

- the amount owed (the negative net, in whole kobo) and the **balance still owed**, derived from the cuts so a recalculation never double-counts;
- one **recovery cut per payroll** (a small new table: the adjustment, the run, the amount taken, the balance after), so every kobo can be traced to a payroll and a payslip;
- statuses: *approved* (waiting for its first payroll) → *recovering* (part taken) → *recovered* (balance nil); plus *waived* (below).

**Rules I would build in:**

1. **Regular payrolls only.** A supplementary payroll takes no recovery (it pays corrections; mixing the two makes the cap and the payslip hard to read).
2. **Calculating the same payroll again** replaces its own cut and never adds to it (the same rule as piece B).
3. **Only after review:** an adjustment that is not approved is never recovered. The reviewer is, as now, never the shift's approver and never the person.
4. **Waiving a balance** (the company decides not to recover) is a **separate approval** by someone with the payroll approval right who is **neither the reviewer nor the person**, with a reason kept on the record (never in the audit log). What happens to the late shift's held pay is **your decision (question 8)**: today it stays held for as long as the adjustment stands. The audit keeps ids and numbers only.
5. **A person who leaves with a balance:** the balance is offered to the **exit settlement as a manual deduction line** for the settlement's own preparer and approver to accept or waive. It is never taken silently, and the settlement's existing approval stands.
6. **The switch is OFF by default.** A company setting, changed only by someone with the settings right, **with a reason**, audited (who, when, old and new value). While it is off, a negative adjustment behaves exactly as it does today (stays approved, critical finding).
7. **A finding every payroll** while a balance remains: how much was taken, how much is still owed, so Payroll never has to remember it.

## 4. The pieces (each its own pull request; C1 and C2 can be one if you prefer)

| # | Piece | Data | Notes |
|---|---|---|---|
| **C1** | The pure arithmetic: how much a payroll may take under the cap and the net-pay floor, rounded half up once; and the balance record, the recovery-cut table and the setting (OFF). No payroll change yet. | one new table, a few columns on the adjustment, one setting; reversible | tests first; the arithmetic is a pure function with a table of worked cases |
| **C2** | The regular payroll takes the cut, writes the line and the payslip text, raises the findings, marks the cut once, recalculation-safe; the screen shows the balance. | none beyond C1 | **moves money**; needs your explicit "go" |
| **C3** | Waiving a balance (separate approval) and the hand-off to the exit settlement. | none or one column | small |

## 5. Your answers (recorded 2026-11-23: "use your defaults for 1-8")

**All eight questions below are decided as the default shown against each one.** The text of each question is kept so the decision can be read in context. Anything marked "Alternative" was **not** chosen.

1. **What does "the existing 33.33% cap" mean?** It is only a warning today. **Default: make it a real limit for this recovery**, measured as other deductions over total earnings, as the warning measures it. Alternative: use the take-home floor instead (a different measure, today set to 0 = off).
2. **Net pay must never go below zero** because of a recovery. **Default: yes**, and the rest carries forward.
3. **Regular payrolls only**, not supplementary. **Default: yes.**
4. **Does the person get a notice before the first cut** (a message or a document they acknowledge)? Deductions from wages are regulated: this is for the adviser, but I need to know whether the screen should block the first cut until a notice is recorded. **Default: no block; a "notice given on" field on the adjustment that the payslip shows when filled.**
5. **Waiving a balance:** needs a separate approver, neither the reviewer nor the person. **Default: yes.**
6. **A person who leaves:** the balance goes to the exit settlement as a manual deduction line for its own approver. **Default: yes.**
7. **The switch:** off by default, company-level, changed with a reason. Do you also want the switch to **refuse to turn on** until a reference to the recorded P6 review is typed in? **Default: no; the review register stays the control, because the application cannot judge a legal review.** (This was your open question about enforcement in the register.)
8. **What happens to the late shift once a balance is recovered in full, or waived?** Today the shift stays held out of supplementary payrolls for as long as the adjustment stands, and the adjustment already accounts for what the shift is worth (owed 4,000.00 against 8,000.00 paid), so paying the shift again would pay it twice. **Default: the shift stays settled by the adjustment and is never paid again.** Tell me if a waiver should instead pay the shift in full.

## 6. Risks I already see

- **The cap is a new real limit on a figure that was only a warning**: a company that relied on the warning could be surprised. Mitigation: it applies to this recovery only, and only when the switch is on.
- **A recovery changes net pay**, so payment files and bank amounts follow it. The engine already takes deductions before net pay, so no payment-file change is expected; a test must prove the file matches the payslip.
- **Engine change in a critical module** (the cap sits next to the deduction step). I would add it as a new, separate step with its own tests rather than change the loan and advance floor.
- **A balance that is never fully recovered** (a person on very low pay): it carries forward for many payrolls. The finding and the screen make this visible; waiving is the way out.
- **Legal:** consent, notice, cap and treatment on exit are for the adviser (P6). Nothing here is a legal statement.

## 7. Not in this plan

Recovering other kinds of overpayment, interest, recovery by instalment plans agreed with the person, and anything in the legal review itself.
