# Explain-back note: hourly pay, H14 piece 3 (paid public holidays not worked)

Piece 3 of `hourly-payroll-h14-build-plan.md`, on the founder's "CONTINUE" of 2026-11-21 and his answers of 2026-11-20 (public holidays not worked are paid) and 2026-11-21 (my recommendations for the build plan's questions 3, 4, 5 and 7, which he accepted). It builds on step 2b (the pay for sick days, #259, merged) and reuses its average-hours rule and its stored extra pay line. **No migration** (the table and the `dates` column came with 2b). **It changes pay only for people paid by the hour who are owed a holiday not worked, so every other payroll is calculated exactly as before.** Files: `src/server/services/holiday-pay.ts` (new, critical), `src/server/services/payroll.ts` (critical), `src/server/services/sick-pay.ts` (one function widened), the payslip.

## What it does, step by step

1. **For each public holiday in the pay period** (the company's list; some are limited to states) it finds the people who could be owed it: **employed on that day, paid by the hour that day, past the service period for annual leave** (12 months, the leave policy: the same wait as for monthly staff and for the leave percentage), and not already paid for that holiday by another payroll.
2. **A holiday is paid only when all of these hold:** (a) it applies to **the state of the place they work** (your H11: the state of the site where they last worked in the averaging period; a holiday with no states is national); (b) it is one of their **usual days** (a day of the week they worked at least once in that period); (c) they **did not work it** (a worked holiday is already paid with the hours at the holiday rate, your H3); (d) they are **not on approved sick leave that day** (a sick day is paid as sickness, never also as a holiday).
3. **A person with no hours in the months before is simply not owed it:** no pay and **no finding** (otherwise every inactive hourly person would block the payroll on every holiday).
4. **The amount** is the same rule as a paid sick day: the person's **average daily hours** (their approved hours in the months before the holiday, the payroll rule's "months averaged", 3, divided by the days they worked) times their **weekday rate**, in whole kobo, rounded half up once, **for each holiday**.
5. **Where it goes:** it is **part of the gross of the site where they last worked**, divided by that site's salary structure, with pension and PAYE as for hourly pay (your H8 and H12); counted by the minimum-pay warning; stored with the payroll record (one line per holiday, with the day paid); replaced on recalculation, never doubled; shown on the payslip as "Holiday pay (2046-03-07)" with the hours and the rate.
6. **A holiday is paid once:** a supplementary payroll leaves out the holidays the period's other payrolls already paid.
7. **Findings.** Blocking (until Finance overrides with a reason): a holiday is owed but the person has **no approved hourly rate** for their job role that day, or the site has **no salary structure**. **A warning, once for the payroll,** when the company's public holidays for the year have **not been confirmed** (so holiday pay may be missing).
8. **Reading history is cheap:** the hours, days worked, days of the week and last site are totalled **in the database**, a few rows for each holiday, not every shift of every person; a month with no holiday reads only the holiday list.

## Where each rule comes from

Your answers of 2026-11-20 and 2026-11-21 and my recommendations he accepted. The holiday list and its states are the company's data (H11); the service period is the leave policy; the average months is the payroll rule; nothing is hard-coded.

## Worked example (invented rate: weekday 1,000 an hour)

A guard worked Monday to Thursday, 8 hours a day, in January: an average of 8 hours and usual days Monday to Thursday. In March the company's list has: Wednesday 7 (national), Friday 9 (national), Monday 12 (Lagos only) and Tuesday 13 (FCT only). The guard works at a Lagos site and worked none of these days. They are paid for **Wednesday 7** (8 h x 1,000 = 8,000) and **Monday 12** (8,000): 16,000. **Friday 9** is not one of their usual days and **Tuesday 13** is an FCT holiday, so neither is paid. Had they worked Wednesday 7, that day is paid with their hours instead; had they been on approved sick leave that day, it is paid as sickness.

## What could go wrong, and what is NOT covered

- **A shift approved late on a holiday already paid as not worked** (the person did work it after all) is **not corrected**: the holiday stays paid and the hours are paid too. Tell me if it happens; a correction rule would be a separate piece.
- **The place they work is the site where they last worked** in the averaging period; a person who splits their time between states is judged on that one site.
- **A holiday on a day a person is on annual leave** is paid (their leave pay is the percentage added to hours, not a payment for days).
- **A weekend holiday** is paid only if they usually work that day of the week.
- **The performance test with this on is piece 4;** a company with no holidays in the month, or none paid by the hour, reads one list and stops.
- **Overtime and night premiums** (H4), minimum hours (H7: none) and hourly client billing (H15) are not part of this.

## Tests that prove it

`tests/unit/payslip-hourly.test.ts` (2 new): the holiday line is named by its date, or by the number of days. `tests/integration/hourly-holiday-pay.test.ts` (8), real payrolls in the demo company for March 2046: the national Wednesday and the Lagos Monday are paid at 8 h x 1,000 each, stored with the day and split by the structure, and not the Friday they never work nor the FCT-only Tuesday; a holiday worked is not paid again; a sick day is paid as sickness and not also as a holiday (2 days, each paid once); nothing before the service period and nothing (and no finding) for a person with no hours; a recalculation replaces the lines; a supplementary payroll does not pay the holidays again; the payslip; the warning once when the year's list is not confirmed and none once it is.
