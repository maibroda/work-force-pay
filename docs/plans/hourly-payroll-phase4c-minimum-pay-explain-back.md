# Explain-back note: hourly pay, phase 4c (3 of 3, part 1), the minimum-pay warning

The H13 piece of phase 4c (`hourly-payroll-phase4-plan.md`), on the founder's answers: H13 (2026-11-19: "a configurable warning only, with a figure you or your adviser enter; no figure in the code; it never blocks pay") and 2026-11-20 (the figure is kept in the payroll rules, effective-dated). **One small, additive migration** (`20261230090000_hourly_minimum_pay`, with `down.sql`, round-tripped down, up on a copy of the database with no drift left). It changes no amount and blocks nothing. Files: `src/lib/payroll/hourly-minimum.ts` (new, pure), `src/server/services/payroll.ts` (critical, in CODEOWNERS: one check in the pay run), `src/server/services/statutory.ts` (the payroll rule: store, validate, copy), the payroll rules settings page, the migration.

## What it does, step by step

1. **A new setting on the payroll rule:** "Minimum monthly pay for staff paid by the hour", in naira and kobo. It is part of each payroll rule version, so it is **effective-dated with version history and an audit entry** like every other payroll rule setting (the existing "create new version" step). **0, the default, means no check**; every existing rule keeps working exactly as before. **No figure is built into the code.** It is validated: not negative, at most two decimal places.
2. **The pay run reads the figure in force on the period's last day** (as it reads every payroll rule).
3. **For each person paid ONLY by the hour in the month** (they earned from hours and have no monthly gross), it adds the person's hourly pay for the month (the sum of their stored hourly lines, in whole kobo) and compares it with the figure. **Below the figure: a WARNING finding** that names the person, the month, what they earned, the figure and the shortfall. **At the figure or above: nothing.**
4. **It only warns.** The finding is a warning (never critical), needs no explanation, and does not stop the payroll being approved. Pay is exactly what the hours earned; nothing is topped up or changed.
5. **Who is not checked:** a person paid monthly (however low), a person paid by the hour AND monthly in the month (a part-month of each: there is no clear month's hourly pay to compare), a person with no hours (nothing is paid), and supplementary payrolls (late hours are only part of a month).

## Where each rule comes from

The figure, its effective date and what counts as below it are the founder's H13; the comparison basis is **my reading of the assessment's wording ("monthly hours x rate falls below a figure the company sets")**: what a person paid only by the hour earned from hours in the month. **Please confirm** that is what you want compared (not, for example, the hourly rate itself against an hourly minimum).

## Worked example (invented figures)

The company's payroll rule from 1 March says: minimum monthly pay for staff paid by the hour 50,000.00. In March three hourly guards: A worked 4 hours (4,000.00), B worked 50 hours (50,000.00), C worked 60 hours (60,000.00). The payroll warns only about A: "earned NGN 4,000.00 from hours worked in March, which is NGN 46,000.00 below the minimum monthly pay of NGN 50,000.00 ... a warning only". B is exactly at the figure and C above it: no finding. A is paid the 4,000.00 their hours earned, in the usual way.

## What could go wrong, and what is NOT covered

- **A person who joins or leaves mid-month, or works few hours on purpose, will be warned.** That is why it is only a warning and says "a person who worked few hours is paid for those hours".
- **The figure is a monthly amount for the whole company**, not per contract or per job role.
- **It does not say what the legal minimum is, and does not check it:** the figure is whatever you or your adviser enter.
- **Leave and sickness for hourly staff (H14)** and the performance test for 3,000 hourly people are still to come.

## Tests that prove it

- `tests/unit/hourly-minimum.test.ts` (6): nothing at 0, nothing at or above the figure, a warning (never critical) with both figures and the shortfall below it, exact to the kobo, nothing for someone who earned nothing from hours, no floating-point maths.
- `tests/integration/hourly-minimum-pay.test.ts` (4): the setting is 0 unless set, validated, versioned, effective-dated and copied to a new organization; a real payroll warns for the person below the figure (with the figures), not for one exactly at it or above it, never blocks (no critical finding) and leaves the pay exactly as earned; a month before the version with the figure has no warning; a monthly person is never warned.
