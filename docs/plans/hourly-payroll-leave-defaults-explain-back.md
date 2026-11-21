# Explain-back note: hourly pay, the founder's figures (defaults for new settings)

On the founder's message of 2026-11-21: **the leave percentage "could be determined by the contract but 2.5% could be used as default", 5 paid sick days, 3 months averaged**; and his answers that day: the contract's own percentage lives **on the contract's rate** (the next step, below), and the figures are **defaults for NEW settings only**. **One tiny migration** (`20270103090000_leave_defaults`, with `down.sql`, round-tripped down and up on a copy with no drift left). **It changes what a NEW row starts with, not any stored value, so no past or open payroll changes.** Files: `prisma/schema.prisma`, `src/server/services/statutory.ts`, `prisma/seed.ts`.

## What it does

1. **Leave pay for staff paid by the hour starts at 2.5%** for a payroll rule version that is created without a figure (the rule service's default and the stored default for a new row). A version created WITH a figure keeps it, and **0 still means none**.
2. **Paid sick days start at 5** for a company that has no leave policy yet (the policy is made the first time anything reads it). A policy that already exists keeps its value.
3. **3 months averaged** was already the default of the payroll rule setting; nothing changed.
4. **Existing settings are not touched.** Every existing payroll rule version keeps the leave percentage it has (0) and every existing leave policy keeps its paid sick days (0), so no calculation of any past or open month moves. **To switch leave pay on for a company, create a new payroll rule version dated from the day you want, with 2.5 (or another figure); to switch sickness on, set the paid sick days in the leave policy.** The forms show the company's current values, so a new version created for another reason keeps leave pay as it was (a deliberate safe choice: tell me if you would rather the form suggest 2.5).
5. **The demonstration company's own rule is made explicitly 0** in the demonstration data, so its figures (and the tests that use it) stay as they were. A real company's rule starts at 2.5 only when it is made without a figure.

## What could go wrong, and what is NOT covered

- **A new company copies its payroll rules from the bureau's master tables** (the existing process), so its leave percentage is whatever the master version says. **To make new companies start at 2.5, enter 2.5 on the master (bureau) payroll rule.** I did not change the copy.
- **A company with no leave policy yet now gets 5 paid sick days the first time its policy is read**, so paid sick leave is on for it from then: that is the founder's default for a new policy. A spell still needs a medical certificate and HR's approval, and only staff paid by the hour can have one.
- **The contract's own percentage is not built yet:** it is the next step. Until then every contract uses the company's percentage.

## Tests that prove it

`tests/integration/leave-defaults.test.ts` (4): a company with no policy gets 5 paid sick days and an existing policy keeps its 0; a rule version created without a figure starts at 2.5 and one created with 0 is 0 (by date); a rule row made without a figure gets 2.5 and one with a figure keeps it; the demonstration company's rule is 0. Two existing tests were updated to say the new defaults (a company chooses 0 explicitly to test "not set up"; the leave percentage test expects 2.5 for a version created without a figure). The data dictionary was regenerated.
