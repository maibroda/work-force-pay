# Explain-back note: hourly pay, H14 piece 2, step 2b (the pay for sick days)

Step 2b of piece 2 (paid sickness) of `hourly-payroll-h14-build-plan.md`, on the founder's "CONTINUE" of 2026-11-21, on his answers of 2026-11-20 and 2026-11-21 and my recommendations for the build plan's questions 3, 4, 6 and 7 that he accepted ("your choices"). It builds on step 2a (recording and approving a spell, #258), so **it is stacked on that branch and can only be merged after 2a**. **One small additive migration** (`20270102090000_sick_pay`, with `down.sql`, round-tripped down and up on a copy with no drift left). **Off by default: paid sick leave only exists once the leave policy's paid sick days are above 0 and a spell has been recorded and approved, so every existing payroll is calculated exactly as before.** Files: `src/lib/payroll/sick-pay.ts` (new, pure), `src/server/services/sick-pay.ts` (new, critical), `src/server/services/payroll.ts` (critical), `src/lib/payroll/engine.ts`, the payslip and the payroll rules page.

## What it does, step by step

1. **The pay run looks for approved sick days in the pay period** for people paid by the hour (spells approved by HR in step 2a), only when the leave policy's paid sick days a year is above 0.
2. **The average.** For each spell it takes the person's **approved hours in the months before the spell** (the new payroll-rule setting "Months of hours averaged to pay a sick day", **3** as recommended: 1 to 24) and divides them by the **days they worked** (two shifts on one day are one day). That is their average daily hours. **A person with no approved hours in that period has nothing to average: nothing is paid and a blocking finding says so.**
3. **Which days are paid.** (a) Only the first **5 days of the leave year** (the leave policy's figure), counted in date order across all of that year's approved spells; the rest are not paid and a warning names them. (b) Only a **usual day**: a day of the week they worked at least once in that period (so a person who never works Fridays is not paid a sick Friday; a warning names such days). A day that is not a usual day **still counts against the 5**, because it was a day of sickness.
4. **The amount.** Days paid x average daily hours x the person's **weekday rate** (the approved hourly rate in force on the day, found the same way as for hours): `rate x total minutes x days / (days worked x 60)`, in whole kobo, **rounded half up once** on the whole amount (never day by day).
5. **Where it goes.** The sick pay is **part of the gross of the site where they last worked** in that period: the site's established salary structure divides it (Basic, Housing, ...), it counts for pension and is taxed through PAYE exactly like their hours (your H12). If they also worked at that site in the month, it joins that site's pay. It is counted by the minimum-pay warning (H13).
6. **Stored** with the payroll record (`HourlyAllowanceLine`, the table piece 1 added): the minutes, the rate used, the amount and **the days paid**, replaced on recalculation, never doubled.
7. **A spell approved after the payroll was locked** is paid by a **supplementary payroll**; it leaves out the days the period's other payrolls already paid (their stored lines name the days), so **no day is paid twice**.
8. **The payslip** shows it after the hours of its site as "Sick pay (2 days)" with the hours and the rate, counted in the total. A person paid only sick pay in the month still gets the section.

## Findings (blocking ones stop the payroll being approved until Finance overrides them with a reason)

- **Blocking:** a spell waiting for approval (not paid); no approved hours to average; no approved hourly rate for the person's job role on the day; no salary structure for the site; two approved rates in force at the same level.
- **Warnings:** days beyond the 5 paid days; days that are not one of the person's usual days.

## Where each rule comes from

Your answers of 2026-11-20 (a paid sick day, 5 days a year, paid at average hours x weekday rate) and 2026-11-21 (my recommendations for questions 3, 4, 6 and 7: a 3-month average per day worked, usual days, the same leave year, part of gross split by the site's structure with the site last worked). The 5 days and the 12-month wait are the leave policy's; the average months is the payroll rule's; nothing is hard-coded.

## Worked example (invented rate: weekday 1,000 an hour)

A guard worked Monday to Thursday, 8 hours a day, for a week in January: 4 days, 32 hours, so an average of 8 hours a day and usual days Monday to Thursday. They are ill on Monday 6 and Tuesday 7 March, approved by HR. The March payroll pays 2 days x 8 h x 1,000 = 16,000, at the site where they last worked, divided by its structure; the payslip says "Sick pay (2 days) 16 h at 1,000.00 = 16,000.00". If they had been ill Monday to Friday, Monday to Thursday would be paid (32,000) and Friday would be a warning (not a usual day). If it was their 6th sick day of the year, it would be a warning and not paid.

## What could go wrong, and what is NOT covered

- **The average is over the months before the spell's FIRST day**; a long spell is averaged once.
- **A person's usual days are the days of the week in that period, not their rota.** A person who worked one Friday in the period is paid for Fridays.
- **The rate is the weekday rate on the first paid day;** if the rate changes in the middle of a spell, the whole spell uses the first day's.
- **A correction to an approved spell that was already paid** (a wrong date) is not handled: an approved spell cannot be cancelled (2a) and the supplementary payroll never claws back; if it happens, tell me. 
- **A spell in a month with no payroll yet** is simply paid when that month's payroll is calculated.
- **Paid public holidays not worked** (piece 3) reuse this average and are not built. The screens (2c) are not built. The performance test with this on is piece 4; **the pay run does one extra read only when paid sick days are set up and a spell is approved in the period**, so a company without them is unaffected.
- **The 12-month service period applies** because a spell cannot be recorded before it (step 2a); please confirm that is what you want.

## Tests that prove it

- `tests/unit/sick-pay.test.ts` (14): the window, the basis (distinct days, usual days, the site last worked, nothing when there are no hours), which days are paid (usual days, the entitlement in date order, a non-usual day counts against it, every day accounted for once), the amount to the kobo rounded once, merging into the hours of the same site, no floating-point maths.
- `tests/unit/payslip-hourly.test.ts` (2 new): the sick pay line with days, hours and rate, counted in the total; one day; sick pay and no hours.
- `tests/integration/hourly-sick-pay.test.ts` (8), real payrolls in the demo company: 2 days at the average and the weekday rate, stored with the days and split by the structure; added to hours worked and not doubled on recalculation; only usual days paid; only the first 5 days of the year with a warning; no hours to average is blocking and pays nothing; a spell waiting for approval is blocking and pays nothing; a spell approved after the lock is paid once by a supplementary payroll and the days the regular payroll paid are not paid again; the payslip.
