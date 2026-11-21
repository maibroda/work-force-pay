# Explain-back note: a shift approved late on a holiday that was already paid as not worked

The last pay case on my list of known limitations after H14. **A finding only: no pay figure, payroll rule, setting or payslip changes, and no migration.** I took the same approach you already approved for every other correction after payment (no negative pay, a finding for Payroll to deduct). If you want the difference handled another way, say so before this is merged.

## What was wrong

A public holiday a person did not work is paid as "holiday not worked" (their average daily hours at the weekday rate). If, **after that month was locked**, a shift the person did work on that very holiday was approved, the supplementary payroll paid the shift at the rates of the day, and the not-worked pay stayed paid: **the person was paid twice for the day**, and nothing said so.

## What it does, step by step

1. When a **supplementary payroll** pays late hours, it also reads the "holiday not worked" pay the period's payrolls **already stored** (the lines, in whole kobo; payrolls that were replaced are ignored).
2. For each person whose newly paid shifts fall on a day already paid as not worked, it raises **one critical finding** in that supplementary payroll: "[person] was paid for the public holiday on [date(s)] as a day not worked in [month], and a shift worked that day was approved after the payroll was locked and is paid now. That is about NGN [amount] paid for the day as not worked. No negative pay is made: enter a deduction for it if it is to be recovered."
3. **The shift is paid as usual and nothing is taken back.** Payroll decides whether to recover the not-worked pay, through a deduction, under the deduction rules.
4. **Once only:** the finding is raised in the payroll that pays the shift, and a shift is paid once, so it is not repeated. A late shift on any other day raises nothing. If the person's shift is approved **before** the month is locked, the regular payroll simply does not pay the day as not worked, and no finding is needed (that was already so).
5. A shift that cannot be paid (for example no hourly rate) raises its own existing finding and no new one, because the finding is only about shifts that are paid in this payroll.

## Where each rule comes from

Your decisions of 2026-11-20 and 2026-11-21 (a worked holiday is paid at the holiday rate and never also as "not worked"; a correction after payment never makes negative pay and is flagged for a manual deduction).

## Worked example (invented figures)

A guard's usual days are Monday to Thursday, 8 hours, at a weekday rate of 1,000. Monday 2 March is a Lagos holiday and no shift is recorded for them that day, so March's payroll pays **8,000.00** as a holiday not worked. March is locked. Later, their supervisor approves a shift they did work on 2 March (8 hours), and a supplementary payroll pays it. That payroll shows **one critical finding**: the holiday on 2054-03-02, about **NGN 8,000.00** paid for the day as not worked, enter a deduction if it is to be recovered. Their pay for the shift is unchanged.

## How this relates to the founder's later decision on the late-approved holiday adjustment

The founder has since decided that a public-holiday shift approved after payroll paid the day as not worked should be corrected **through the next open payroll** (the original closed payroll untouched; the corrected entitlement less what was already paid; only the net difference paid or recovered; linked to the shift, its approval and the original payroll line; supervisor approval and payroll review; no duplicate adjustment; an authorised alternative if the next payroll is closed). **That is a larger piece, still to be planned, and it asks for a recovery the pay rules so far never made (no negative pay).** This pull request is the safeguard that exists until then: it makes the double payment visible, in the payroll that pays the shift, and changes no money.

## What could go wrong

- The finding is **advice**: nothing is deducted automatically.
- The amount comes from the stored line (what was paid), not a recalculation.

## Which tests prove it

`tests/integration/hourly-holiday-late-shift.test.ts` (2): a late shift on the holiday paid as not worked (the shift is paid, one critical finding naming the date and the 8,000.00, no second not-worked line, no negative pay); a late shift on another day raises nothing. The existing holiday and late-payroll tests still pass.
