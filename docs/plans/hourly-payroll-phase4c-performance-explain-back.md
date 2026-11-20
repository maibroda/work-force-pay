# Explain-back note: hourly pay, phase 4c (3 of 3, part 2), the performance test and what it found

The last planned piece of phase 4c (`hourly-payroll-phase4-plan.md`, step 5; the project's rule 12: payroll for 3,000 workers must complete in 10 minutes or less). **No migration, no change to any amount.** It adds the test the plan asked for, and **the test found a real fault in the pay run that I fixed**. Files: `tests/integration/hourly-performance.test.ts` (new), `src/server/services/payroll.ts` (critical, in CODEOWNERS), `src/server/services/hourly-payroll.ts` (critical).

## The test

It builds a company of its own with **3,000 people paid by the hour, each with 30 approved shifts in one month (90,000 shifts), across 20 sites of two clients**, and runs the real pay run. It checks: (1) the first calculation finishes **inside 10 minutes**; (2) every one of the 3,000 is paid exactly what their hours earned (the expected pay is worked out in the test, independently of the pay run), every minute of every shift appears once on the stored pay lines, and every piece of every shift is marked as paid once, with no critical finding; (3) **a recalculation** (which replaces everything the first one stored) also finishes inside 10 minutes and changes nothing. It runs in CI with the rest of the suite. It adds about 4 to 5 minutes to the suite, most of it creating the 90,000 shifts.

## What it found

On the first run, with 3,000 people and 90,000 shifts, **the pay run failed**: saving the payroll to the database is one transaction with a 2-minute limit, and on a cold database it needed about 128 seconds, so it was rolled back and nothing was saved. The pay run in full took about 162 seconds. (A second calculation, with the database warmed up, took about 93 seconds, which is why this is a fault that appears on the first calculation of a large month.) Nothing had gone wrong in production because no company has hourly pay switched on yet.

Where the time went (first run): **about 86 of the 128 seconds saving the 90,000 "this piece was paid" marks** (one row at a time through the database layer), about 35 seconds saving the 3,000 payroll records themselves, and about 24 seconds working out 3,000 people, part of which was scanning all 90,000 pieces once for every person.

## What I changed (all in code I wrote in phases 4b and 4c)

1. **The marks are saved in bulk**: one database statement per 20,000 marks, from lists passed as parameters (nothing is built into the SQL text, so there is no injection risk). Marks with no payroll record (the few from a settled correction) still go through the usual path.
2. **The pieces are grouped by person once**, instead of scanning all of them for each person.
3. **The save transaction's time limit is raised from 2 to 5 minutes**, which keeps a wide margin inside the 10-minute rule for a whole payroll. It is a safety valve, not a target: the aim is a save well under a minute.

## Results

The test passes (4 of 4). The whole test file, including creating the 90,000 shifts, took about 267 to 328 seconds on my laptop across the runs after the fix, against 426 seconds before it (when the first calculation failed). Both calculations are well inside 10 minutes. **I did not capture the per-calculation times** (the test prints them, but the test runner did not show them for a passing test); I worked them out roughly from the file's total time: about 1 to 2.5 minutes each. CI runs on a different machine, so its figures will differ.

## What could go wrong, and what is NOT covered

- **Saving the 3,000 payroll records took about 35 seconds on a cold database** (10 seconds warmed up). That is the existing pay run, not the hourly code, and I did not change it. It stays inside the new limit with a wide margin.
- **A company with more than 3,000 hourly people or more than 30 shifts each** will take proportionally longer; the 5-minute transaction limit would be reached at roughly 4 to 6 times this size. That is well beyond rule 12.
- **A company of monthly and hourly staff together** at this size is not tested; the smaller mixed tests (a monthly person next to hourly people) pass.
- **This measures the database and the pay run, not the web page** (rule 12's 3-second page response is a separate matter).
- **Supplementary payrolls** (late hours) still save their marks through the usual path; they carry only the late hours, so they are small.

## Tests that prove it

`tests/integration/hourly-performance.test.ts` (4): the data is what the test says; the first calculation pays all 3,000 inside the limit; every person is paid exactly what their hours earned, with every minute and every piece accounted for and no critical finding; a recalculation also finishes inside the limit and changes nothing. The existing hourly pay run, late-hours, payslip and payroll tests pass with the changes. Before the fix the first of these failed (the transaction timed out), which is how I know the test has teeth.
