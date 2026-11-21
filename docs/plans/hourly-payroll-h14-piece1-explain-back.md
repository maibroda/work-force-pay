# Explain-back note: hourly pay, H14 piece 1 (the leave percentage)

Piece 1 of `hourly-payroll-h14-build-plan.md`, on the founder's "go with piece 1" of 2026-11-21 and his decisions of 2026-11-20 and 2026-11-21 (annual leave for people paid by the hour is **a percentage added to every hour worked**, due **only after 12 months' service**, the figure is his or his adviser's; the percentage is of all pay for hours worked and is part of gross, split by the site's salary structure). **One additive migration** (`20261231090000_hourly_leave_percent`, with `down.sql`, round-tripped down and up on a copy of the database with no drift left). **Off by default: the percentage is 0 until the company enters one, and every existing payroll is calculated exactly as before.** Files: `src/lib/payroll/hourly-leave-pay.ts` (new, pure), `src/lib/payroll/engine.ts` (critical), `src/server/services/payroll.ts` (critical), the rule service, the payslip and settings page.

## What it does, step by step

1. **A new setting on the payroll rule:** "Leave pay for staff paid by the hour (% added to every hour worked)", at most two decimal places, 0 to 100. Part of each payroll rule version, so it is **effective-dated with version history and an audit entry**. **0 (the default) means no leave pay, and no figure is built into the code.**
2. **Who gets it:** a person paid by the hour, **from the day they complete the company's service period for annual leave** (the leave policy's months of service, 12 as shipped, counted from their employment date: the same rule as monthly staff). Hours worked before that day earn no leave pay; hours on or after it do.
3. **What it is worked on:** the pay for **every hour worked on or after that day** (weekday, weekend and holiday hours alike, at their own rates). Each line's eligible hours are priced to the kobo and the percentage of their total is taken, rounded half up once per site.
4. **Where it goes:** it is **part of the site's gross**. The site's salary structure divides it (Basic, Housing, ...), it counts for pension and is taxed through PAYE exactly like the hours (your H12). Net pay, deductions and the minimum-pay warning (H13) all see it as earnings.
5. **Stored with the payroll record** in a new table (`HourlyAllowanceLine`): the pay it was worked on, the percentage as used and the amount, so a later change of the setting cannot alter a payroll already worked. Replaced when the payroll is calculated again, never doubled.
6. **Late hours** (paid by a supplementary payroll) get the leave percentage too, for the hours that are eligible.
7. **The payslip** shows it after the hours of its site as "Leave pay (10% of 8,000.00)", counted in the total, on the screen and on the PDF.
8. **The piece 0 warning's wording changes:** once a percentage is set, the warning (and the note shown when annual leave is requested or approved) says that their leave pay is the percentage added to every hour they work, not a payment for the days. Nothing is refused.

## Where each rule comes from

Your answers of 2026-11-20 (option D, 12 months' service, the figure yours) and 2026-11-21 (my recommendations for questions 2 to 8: the percentage is of all pay for hours worked; it is part of gross and split by the site's structure; shown as its own payslip line). The service period is the existing leave policy; the percentage is the rule setting; nothing is hard-coded.

## Worked example (the 10% is a test figure, not a recommendation)

A guard in service since 2040 works a Monday for 8 hours (8,000) and a Saturday for 8 hours (12,000): 20,000 of hours. With the rule at 10%, leave pay is 2,000, so the gross is 22,000, divided by the site's structure like any hourly pay, with pension and PAYE worked on 22,000. The payslip shows the two lines of hours and "Leave pay (10% of 20,000.00) 2,000.00". A guard who joined in January 2043 has no leave pay in March 2043. A guard who completes 12 months on 15 March gets it only on the hours worked from 15 March: a 10-hour shift on 9 March earns none, an identical one on 16 March earns 1,000.

## What could go wrong, and what is NOT covered

- **The percentage and the 12-month wait are your or your lawyer's decision**, not a statement of what the law requires; the system only does what the setting says.
- **Leave pay is part of gross on the payslip, but the hourly reports** (indicative cost by site) **do not include it yet**; they still show the pay for hours only. That is a later small change if you want it.
- **A person's service is counted from their employment date**, as for monthly staff; a break in service is not subtracted.
- **If the rule version in force changes mid-month**, the version in force on the last day of the pay month is used for the whole month (as for every other payroll rule).
- **Paid sickness, paid holidays not worked** and the 3,000-person test again are pieces 2 to 4. The performance test was not rerun for this piece (it runs with the percentage at 0); piece 4 measures it with leave pay on.
- **Annual leave "days" for hourly staff** are not refused; their leave pay is the percentage, and the days are time off (the warning says so).

## Tests that prove it

- `tests/unit/hourly-leave-pay.test.ts` (8): the percentage of the eligible hours only, nothing before eligibility or at 0%, per site, rounded half up once, a percentage outside 0 to 100 refused, inputs never changed, no floating-point maths.
- `tests/unit/engine-hourly.test.ts` (4 new): the leave pay is part of the site's gross and gives exactly the same split, pension, PAYE and net pay as the same gross earned as hours; it is carried for the stored breakdown; it works in a supplementary run; a negative or part-kobo amount is refused.
- `tests/unit/hourly-earnings.test.ts` (3 new): the minutes worked on or after the eligibility day are marked on each line.
- Payslip and wording: `payslip-hourly` (4 new), `payslip` (1 new), `hourly-leave` (1 new).
- `tests/integration/hourly-leave-percent.test.ts` (7), real payrolls in the demo company: the setting is 0 unless set, validated, versioned, effective-dated and copied; 10% of all hours (weekday and weekend) added, stored and split by the structure; nothing for a person not yet past 12 months, and only the hours from the day they complete them; nothing at 0%, for a monthly person, and a recalculation replaces the line; late hours in a supplementary payroll carry it; the payslip and PDF model show it and count it; the minimum-pay warning counts it; another company cannot read it.
