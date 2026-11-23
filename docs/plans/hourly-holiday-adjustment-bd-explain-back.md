# Explain-back note: the late-holiday adjustment, pieces B and D (the net difference is paid in the next open payroll; the supplementary payroll stops paying the late shift)

Pieces B and D of `hourly-holiday-adjustment-plan.md`, built together on the founder's answer ("Build B and D together"), because B alone would pay the day three times (8,000.00 paid as not worked, 16,000.00 by the supplementary payroll for the late shift, and 8,000.00 more as the net difference). **These pieces CHANGE PAY. Piece C (recovering an overpayment from pay, within the 33.33% cap with the rest carried forward) is NOT built: a negative difference is never taken, it only raises a finding.** Nothing here is production-ready until the legal and payroll-tax review of deductions from wages and of the corrected holiday pay (items P5 and P6 of `docs/legal-review/hourly-payroll-policies-review.md`) is recorded.

## What it does, step by step

1. **Piece D, the hold.** A supplementary payroll (it pays the hours that missed the locked payroll) leaves out a late shift on a public holiday **when a holiday adjustment exists for that person and day and is waiting for review, approved, or already applied**. The adjustment settles that day, so the shift is not also paid in full. **A rejected adjustment holds nothing**: the supplementary payroll pays the shift in full at the holiday rate as before, and the #268 finding ("paid as not worked and worked") still tells Payroll about the double pay. Only hours of that **holiday itself** are held; any other shift is paid as before.
2. **A held shift is not marked paid**, so the hours reports can still show it as not yet paid while the adjustment waits. A **warning** ("holiday adjustment held") on the supplementary payroll says which person and day, and whether the adjustment is waiting for review or approved.
3. **Piece B, the pay.** The regular payroll of the **earliest open period after the period that paid the day as not worked** pays an **approved** adjustment's net difference **once**: the corrected entitlement (the hours worked that day at the holiday rate) less what was paid. It is an **extra pay line, "Holiday adjustment (date)"**, at the site, contract and client of the shift, split by that site's salary structure like the hours, so it is taxed and counted for pension like the hours. A period that is not the earliest open one after the original leaves it alone.
4. **Once only.** When the payroll is saved the adjustment becomes **applied**, linked to that run and the time, with one audit entry (ids and numbers only). Calculating the same payroll again pays the same single line again and changes nothing; no other payroll pays it. The closed payroll and its lines are never touched.
5. **A net of zero** is applied with no pay line.
6. **A negative net (an overpayment) is NOT recovered.** The adjustment stays approved, nothing is taken, the shift stays held, and a **critical finding** on the payroll says how much was paid too much and that a deduction has to be entered by hand if it is to be recovered. This waits for piece C and its legal review.
7. **Escalation.** If no open period exists after the original one, nothing can pay the approved adjustment: the Public holidays page says so in red against it ("open the next period so it can be paid"), and a **critical finding** is raised in the supplementary payroll of the original period. The list also shows, for a waiting or approved adjustment, which payroll would take it.
8. **A missing salary structure** at the shift's site stops the pay (critical finding) and the adjustment stays approved.

## Where each rule comes from

The founder's confirmed decision (corrected through the **next open payroll**, net difference only, closed payroll untouched, supervisor approval and payroll review first, no duplicates, escalate if no payroll is open) and his answer to build B and D together. The "earliest open period after the original" is my reading of "next open payroll"; **correct it if you meant something else.** A rejected adjustment paying the shift in full is my reading of "the reviewer said no change": **correct it if a rejection should still hold the shift.**

## Worked example (invented figures)

Weekday rate 1,000, holiday rate 2,000; a guard works Monday to Thursday, 8 hours. Monday 8 March is a holiday; March's payroll paid **8,000.00** as a holiday not worked and is locked. Their 8-hour shift that Monday is approved late; an adjustment is proposed: corrected **16,000.00**, net **+8,000.00**. While it waits, a supplementary payroll for March pays them **nothing** for that shift (a warning says why). A reviewer approves it. April is open: April's regular payroll pays a line **"Holiday adjustment (8 March)" of 8,000.00**; the adjustment becomes applied. In total the day is paid 8,000.00 + 8,000.00 = 16,000.00, the same as if the shift had been approved in time. If the shift had been only 2 hours (owed 4,000.00) the net would be **-4,000.00**: nothing is taken and a critical finding says so.

## What could go wrong

- **A held shift is "unpaid" in some reports** until the adjustment is applied (the pay is in the adjustment line, not in the shift's pieces).
- **A rejected adjustment pays the shift in full on top of the 8,000.00 already paid** (the overpayment is only reported by #268's finding, as before).
- If the next open period is **not** opened, the adjustment waits (and is escalated); it is never paid by a period earlier than the original.
- Recovery of an overpayment is **not built**.
- The "Holiday adjustment" kind and the applied status are new database values: rolling the migration back **deletes** applied lines (see below).

## Which tests prove it

`tests/integration/holiday-adjustment-pay.test.ts` (7): the late shift is held while the adjustment waits (warning, the other guard's late shift still paid); a rejected adjustment lets the supplementary payroll pay the full 16,000.00 and raises #268's finding; applying in April (8,000.00 line at the shift's site, applied and linked to the run, audited once, recalculation unchanged, March untouched, no supplementary payroll pays the shift, the payslip shows "Holiday adjustment (date)"); only the earliest open period applies it (May leaves it alone, never twice); a waiting adjustment is not applied and the list names the payroll that would take it; an overpayment stays approved with the critical finding; no open period is escalated. The earlier tests for pieces A, #268 and the hourly pay still pass (see the release notes for the run).

## Migration and rollback

`20270110090000_holiday_adjustment_apply`: two new enum values (applied status, "holiday adjustment" kind of pay line) and two nullable columns on the adjustment (the run that applied it and when). `down.sql` **is destructive for applied adjustments**: it deletes their pay lines and sets them back to approved, so use it only to roll the whole database back after a backup. Round-tripped on a throwaway database with no applied rows (down gives the previous schema, up gives the new one, no difference either time).

## Legal and policy dependencies

Corrected holiday pay is part of gross like the hours (item P5 of the review register). **Recovery (piece C) must not be switched on before the review of deductions from wages (P6) is recorded.** The values are the founder's company policy, not statutory requirements.
