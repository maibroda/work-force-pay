# Explain-back note: hourly pay, phase 4c (2 of 3), the payslip shows the hours

Second piece of phase 4c (`hourly-payroll-phase4-plan.md`), started on the founder's "go with the payslip piece" of 2026-11-20. It builds on phase 4c-1 (late hours by supplementary payroll, #250). **No migration, no change to any amount.** It only shows, on the payslip, what the pay run already stored for a person paid by the hour. Files: `src/lib/payroll/payslip-hourly.ts` (new, pure), `src/lib/payslip-pdf.ts` (the PDF), `src/components/payslip.tsx` (the screen), `src/server/services/payroll.ts` (`getPayslip`, critical, in CODEOWNERS), `src/server/services/hourly-payroll.ts` (a small read), `src/server/services/payslips.ts` (hands the hours to the PDF).

## What it does, step by step

1. **Reads what the payroll stored.** For a payroll record the pay run stored one line per site, kind of day and rate (phase 4b: the hours, the rate used, the amount). `getPayslip` now also reads those lines for that one record, for the caller's company only, with the site's name. Nothing is worked out again: the payslip can only show what the payroll paid. A person paid monthly has no such lines, so their payslip does not change.
2. **Lays them out** (`payslip-hourly.ts`): rows by site and kind of day, weekday then weekend then public holiday, each with the **hours (shown exactly as hours and minutes: 8 h 30 min, never rounded)**, the rate per hour and the amount; a total line; and a line per kind of day. Several lines of the same site, kind of day and rate (the pieces of a supplementary payroll) are shown as one. Amounts are added exactly in whole kobo.
3. **Draws it twice from the same layout:** a "Hours worked and pay" table on the screen payslip and on the PDF, so they cannot disagree. The PDF shows up to nine lines, then "... and N more line(s), included in the total", so it stays on one page.
4. **Says what the pay basis is.** A person paid only by the hour has no contractual monthly gross, so "Monthly gross (contractual): 0.00" is replaced by "Pay basis: Paid by the hour", and their days are shown as "Days worked 3" instead of "3 / 30". A person with both monthly pay and hours keeps the monthly gross and also gets the table.
5. **The earnings lines are unchanged:** they are still the site's salary structure (Basic, Housing, ...) dividing the hourly gross (your H8 and H12); the new table shows how that gross was made up.

## Where each rule comes from

Rates, kinds of day and the amounts are the stored result of the pay run (your H1, H2, H3, H8, H12); the payslip only displays them. The hours display and exact totals follow the project's money rule (whole kobo, no floating point).

## Worked example (invented rates: weekday 1,000, weekend 1,500, holiday 2,000 an hour)

A guard worked a weekday for 8 hours, a Saturday for 8 hours 30 minutes and a public holiday for 4 hours. The payslip shows: Weekday 8 h at 1,000.00 = 8,000.00; Weekend 8 h 30 min at 1,500.00 = 12,750.00; Public holiday 4 h at 2,000.00 = 8,000.00; total 20 h 30 min = 28,750.00. The total earnings of the payslip are the same 28,750.00, split by the structure into Basic, Housing and so on.

## What could go wrong, and what is NOT covered

- **The PDF stops at nine lines** (with a note that the rest are in the total); a person working many sites and kinds of day would not see every line on the PDF. The screen payslip shows all of them.
- **The site column is the site's name only** (not the client's name; the work locations table on the payslip gives the client).
- **An older payroll calculated before hourly lines were stored** (none in use) would show no table.
- **Overtime premiums, the minimum-pay warning (H13) and leave or sickness (H14)** are not part of this piece. The performance test for 3,000 hourly people is the last piece of 4c.
- **Quick payslips** (the one-off payslip tool) are separate and unchanged.

## Tests that prove it

- `tests/unit/payslip-hourly.test.ts` (10): the layout, the ordering, exact hours and totals, the merge of same-rate lines, no floating-point maths.
- `tests/unit/payslip.test.ts` and `tests/unit/payslip-pdf.test.ts`: the screen and the PDF model show the hours table, say "Paid by the hour", keep the monthly gross for a mixed person, are unchanged for a monthly person, and the PDF stays on one page with many lines.
- `tests/integration/hourly-payslip.test.ts` (4), a real payroll in the demo company: the payslip carries the stored lines with the site's name; the PDF model and a download are made from the same lines; a monthly person has none; another company cannot read it.
