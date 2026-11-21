# Explain-back note: hourly pay, H14 piece 4 (the performance test with all the extra pay on)

Piece 4, the last of `hourly-payroll-h14-build-plan.md`, on the founder's "GO" of 2026-11-21. **A test change only: no code, no migration, no change to any amount.** It re-measures rule 12 (payroll for 3,000 workers in 10 minutes or less) with the pay that pieces 1 to 3 added switched ON, because they read more history than the hours alone. It builds on piece 3 (paid public holidays not worked, #261): merge that first.

## What the test does now (`tests/integration/hourly-performance.test.ts`)

A company of its own with **3,000 people paid by the hour, 89,100 approved shifts in March 2041 (about 30 each), across 20 sites of two clients**, through the real pay run, with:

- **the leave percentage on** (10, a test figure) for everyone: every person has been in service since 2040, past the 12 months;
- **paid sick leave on** (5 days a year): **300 people (every tenth) are ill on Thursday 28 and Friday 29 March** (an approved spell and a medical certificate each), so each is paid 2 sick days;
- **a national public holiday on Sunday 31 March that nobody works**, so every person is paid it as a holiday not worked.

It checks that **the first calculation finishes inside 10 minutes, and so does a recalculation**; that **every one of the 3,000 is paid exactly the figure worked out in the test, independently of the pay run** (their hours, the 10% leave pay on them, the holiday, and for the 300 the 2 sick days); that every minute and every piece of every shift is accounted for once; that there is one leave pay line and one holiday line for everyone and one sick pay line for each of the 300; that a recalculation replaces the lines instead of adding to them; and that nothing is blocking.

## Results (measured on my laptop, 2026-11-21)

| | Time | Limit |
|---|---|---|
| First calculation | **91.4 seconds** | 600 seconds |
| Recalculation | **65.8 seconds** | 600 seconds |

The whole test file took **517 seconds** (about 8.5 minutes), most of it creating the 89,100 shifts and their pieces. **That is about 3 to 4 minutes longer than the previous version of the test, so every CI run is about that much longer.** CI runs on a different machine, so its figures will differ; the test prints each calculation's time in its log and can append it to a file (set `WFP_PERF_REPORT` to a file name).

## What this says about the code

The pay for sick days and for holidays reads history for each person and each holiday, and the history is read **as totals in the database** for holidays, and for the few people with a spell for sick days. With all of it on, the 3,000-person payroll took about a minute and a half, the same order as without (the earlier measurement was about 1 to 2.5 minutes with the leave percentage off). **Rule 12's limit is met with a wide margin (about 6 times).**

## What could go wrong, and what is NOT covered

- **One holiday and one spell** in the month. A month with several holidays does one set of totals for each, so it grows with the number of holidays; I did not measure 3 or 4 holidays at once.
- **Everyone has history.** A payroll where most people are new (no history) is cheaper, not dearer.
- **Page speed (rule 12's 3 seconds) and low bandwidth are separate** and not measured here.
- **The shifts are created straight into the database for the test;** a real company enters them over time, so the test is a measure of the pay run, not of entering shifts.

## Tests that prove it

The test itself: `hourly-performance.test.ts` (4): the data is what it says; the first calculation inside the limit; every person paid exactly the independent figure with every line and piece accounted for; a recalculation inside the limit that changes nothing.
