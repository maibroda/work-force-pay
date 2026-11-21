# Explain-back note: hourly pay, H14 piece 0 (the leave safeguard)

Piece 0 of `hourly-payroll-h14-build-plan.md`, on the founder's "your choices, go with piece 0" of 2026-11-21. **No migration and no change to any amount.** It is a safeguard only: today, annual leave approved for a person paid by the hour is silently unpaid, and now the system says so. Files: `src/lib/payroll/hourly-leave.ts` (new, pure), `src/server/services/payroll.ts` (critical, in CODEOWNERS), `src/server/services/leave.ts`, `src/app/actions/leave.ts`.

## What it did NOT do, and why it exists

Hourly pay is for approved hours only, and the pay run drops the work-register days on the days a person is paid by the hour (so nobody is paid monthly and hourly for the same day). Approving annual leave writes "leave" days into the work register, and for a monthly person those days are paid. For a person paid by the hour they are dropped, so **the leave was approved and paid nothing, with no message.** What pays leave for hourly staff is decided (a percentage added to every hour worked) and is piece 1; until then this tells people the truth.

## What it does, step by step

1. **A pure helper** (`hourlyLeaveDates`) finds the approved annual leave days that are working days of the company's leave week (5, 6 or 7 days, the leave policy) and fall on a day the person is paid by the hour (an approved hourly record starting on or before the day). A person paid monthly, or whose hourly record is not approved, has none. Only days inside the pay period count, and a day in two requests counts once.
2. **The payroll warns.** When the payroll is calculated, a person paid by the hour with approved annual leave in the month gets a **warning** (never critical, no explanation needed): "has N approved annual leave day(s) in March 2042 while paid by the hour (the days). Pay ... is for approved hours only and pay for their leave is not set up yet, so those days are not paid. This is a warning only." It is raised even when the person has no hours that month (they have no payroll record, so the warning is how anyone finds out).
3. **Whoever asks for or approves the leave is told.** When annual leave is requested (by the person, or by HR on their behalf) or approved, the confirmation message now ends with a note when some of the days are days the person is paid by the hour: "Note: this person is paid by the hour on 5 of these leave day(s) (...), and pay for their leave is not set up yet, so those days are not paid." Unpaid leave gets no note (it is unpaid by definition). The leave is still accepted: nothing is refused.
4. **Nothing is blocked and nothing changes.** Pay, deductions and the leave records are exactly as before; a person paid monthly sees nothing new.

## Where each rule comes from

The founder's H14 answers of 2026-11-20 and "your choices" of 2026-11-21 (annual leave for hourly staff is a percentage added to every hour worked, from 12 months' service, a later piece). The warning, not a block, follows the plan's section 5: refusing leave would change behaviour you have not decided.

## Worked example

A guard paid by the hour worked one 8-hour weekday in March (8,000). HR approved 3 days of annual leave that month. The payroll's pay is still 8,000 (the hours); a warning says "3 approved annual leave day(s) ... not paid". HR, when approving, was told the same. The day the percentage (piece 1) is built, the warning's wording changes to say leave pay is the percentage.

## What could go wrong

- **The wording says "not set up yet".** It must change in piece 1, or it will be wrong once leave pay exists; that is on piece 1's list.
- **Leave on a day a person is paid by the hour but would not have worked** is still counted: the warning is about the working days of the leave week, not the person's pattern (they have none until piece 2 and 3's "usual days" rule).
- **A person who asks for leave through a different route** (importing records, editing the database) is not told; the payroll warning still catches it.

## Tests that prove it

`tests/unit/hourly-leave.test.ts` (9): which leave days fall on days paid by the hour (a six-day week, a mixed month, a monthly person, an unapproved hourly record, a day in two requests, days outside the period), the finding is a warning that names the days and says not paid, a long list is shortened with an exact count. `tests/integration/hourly-leave-safeguard.test.ts` (5), real payrolls in the demo company: a person with hours and leave is warned and paid exactly their hours; a person with leave and no hours is warned; a monthly person, unpaid leave, unapproved leave and leave in another month give no warning; the notice for an hourly person and none for a monthly one; another company's person is not found.
