# Explain-back note: sick and holiday days valued at the average daily GROSS earnings

On the founder's confirmed decision of 2026-11-21 (the three-month averaging basis is **gross earnings**) and his answer to my question: **a paid sick day and a paid public holiday not worked are paid at the person's average daily gross earnings** (the gross pay for the hours they worked in the months before, divided by the days they worked), instead of the first build's "average daily hours x the weekday rate". This changes how sick and holiday pay are worked out, so it is a pay change. **Status: engineering done; NOT production-ready: the adviser review of the three-month gross-earnings averaging method (including which earnings qualify), of the five paid sick days and of the 12-month wait is outstanding.** The method and figures are the founder's company policy, not statutory requirements, until that review confirms otherwise.

## What it does, step by step

1. **A rule setting**, "How a paid sick day or a paid holiday not worked is valued": **the average daily gross earnings** (GROSS_EARNINGS) or **the average daily hours at the weekday rate** (HOURS_AT_WEEKDAY_RATE, the first build). It is part of the payroll rule version: effective-dated, versioned, audited with who, when, old and new value, and copied to a new company. The months averaged (3) is the existing setting.
2. **Defaults for NEW versions only.** A version created without a choice starts on **GROSS_EARNINGS**. **Every existing version and the demonstration company's rule are set to the first build's method by the migration**, so no past or open payroll changes and no company-specific setting is overwritten. To move a company over, create a new rule version from the date you choose.
3. **The reference period:** the months (3 by default) **before the sick spell's first day, or before the public holiday**, from the same day of the month three months earlier up to (not including) that day.
4. **What the gross earnings are:** each approved shift in the period valued at **the approved hourly rate of its own day and kind of day** (weekday, weekend, public holiday), found as the pay run finds rates. A **rate change counts from its date**; a past month is never re-priced at today's rate. **Leave pay, sick pay and holiday pay are never in it** (they are not hours worked, and counting them would count pay twice); only approved hours are read, so no shift or allowance is counted twice.
5. **Which kinds of day count is configurable** (three tick boxes on the rule: weekday, weekend, public holiday; all three by default, at least one). A kind left out is left out of the earnings **and** of the days.
6. **The days worked** are the distinct days with earnings: two shifts on one day are one day; **days not worked (absence, unpaid leave) are not in the days, so they do not dilute the average**; **a new starter or a person who joined part-way through the period** is averaged over the days they have; **a salary (rate) change** is handled by the rule in point 4.
7. **A day with only hours that have no approved rate is not a day of earnings**; those hours are not in the average, and the payroll raises a **warning** saying how many minutes were left out. **A period with no earnings** (no hours, none priced, none of a counted kind) has nothing to average: nothing is paid and the existing blocking finding says earnings are missing.
8. **The amount:** the earnings divided by the days worked, times the days paid, **worked once from the whole ratio and rounded half up to the kobo** (so it never gains or loses a kobo to the number of days).
9. **The rest of the rules are unchanged:** only a usual day of the week they worked in the period is paid; only the first days of the leave year, up to the entitlement, are paid; a holiday is paid only in the state of the place they work, when employed, past the 12-month wait, not worked, not on sick leave; split by the site's salary structure like the hours; a supplementary payroll never pays a day twice.
10. **The calculation is kept for audit** on every stored sick or holiday line: the period, the gross earnings in it, the days worked, the daily average, the days paid, the kinds of day counted and any minutes left out. The hours-times-rate method keeps the minutes and the rate it always stored.

## Where each rule comes from

The founder's brief of 2026-11-21 and his answers (gross earnings; hours priced at their own rates, not leave, sick or holiday pay; the 3 months). The company's choice of which kinds of day count, the handling of unpriced hours and of partial months are **my engineering choices, flagged for the adviser** (see below).

## Worked example (invented figures)

A guard worked three weekdays of 8 hours at 1,000 (8,000 a day) and one Saturday of 8 hours at 1,500 (12,000) in the three months before the spell: **36,000 over 4 days = 9,000 a day**. Two paid sick days = **18,000** (the first build would have paid 16,000: 8 hours x 1,000 x 2). With weekend hours not counted: 24,000 over 3 days = 8,000 a day, so two days = 16,000. A holiday not worked on the same figures pays 9,000.

## What could go wrong

- Sick and holiday pay is **higher** than on the old method whenever a person earns weekend or holiday premiums.
- **Which earnings qualify** is a policy question (see below); the default counts every kind of day.
- Hours before the person had an approved rate are left out with a warning; a gap in the rates lowers the average, never raises it.
- Moving a company onto the new method is a deliberate act (a new rule version); nothing moves by itself.

## Legal and policy dependencies (outstanding, reported separately from the engineering)

Before production use, adviser review of: the three-month gross-earnings averaging method **including which earnings qualify** (all three kinds of day by default; leave, sick and holiday pay excluded); the five paid sick days and any statutory or contractual minimum; the 12-month wait; and the tax and pension treatment of these payments. Record reviewer, date, approved wording and amendments; a conflict goes to the founder before any change.

## Which tests prove it

`tests/unit/hourly-average.test.ts` (12): the gross earnings and days (two shifts one day, window edges, kinds of day counted, unpriced hours and days, no earnings, usual days and last site, a new starter, a rate change), rounding once, no floating point. `tests/integration/hourly-average-gross.test.ts` (7): a sick day on the gross basis (9,000 a day, 18,000 for two days, the breakdown stored, no weekday rate needed); weekend hours left out; no hours (nothing paid, a blocking finding); a holiday not worked (9,000, breakdown); a version made before the decision unchanged (16,000, the rate and no breakdown); the setting (new-version default, validation, at least one kind, effective dates, audit, copy to a new company, the demo rule unchanged). `tests/integration/hourly-performance.test.ts`: the 3,000-person payroll recalculated on the gross basis inside the 10-minute limit. The existing sick and holiday tests still pass on the first build's method.

## Migration and rollback

`20270107090000_average_basis`: the enum and four rule columns (existing rows on the first method, new rows on the gross earnings) and a nullable breakdown on each stored line. `down.sql` removes them (the breakdowns are lost; a rule version then values those days at the average hours x the weekday rate again); round-tripped on a throwaway database.
