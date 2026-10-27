# Plan: exact money, stage 4 (the services around the engine)

**Status: a plan for the founder's "go". Nothing in it has been built.** It touches overtime pay, arrears, deductions, loans, the leaving settlement and the bank payment file. `CLAUDE.md` requires your "go" before I touch any of them, and there are decisions in section 6 that are yours.

**Rule it serves:** rule 2 (exact money, one half-up rounding rule). Stages 1 to 3 are merged (#65, #67, #69, #70): the shared money utility, PAYE, the exact-fraction type, and the payroll engine.

## 1. What exists today

The engine is exact. Around it, the services read a stored amount (a database `Decimal`, always two decimals) as a plain number with `num()`, do arithmetic on it, and round with `round2` (or, in two places, their own copy of it). I went through every service and library on the pay path. They fall into three kinds.

**Kind 1: adding up stored amounts, then rounding.** Run totals (`payroll.ts` `summarize`), the total of a payment batch (`payments.ts`), loan balances and totals (`loans.ts`, `lib/loans.ts`), settlement totals (`settlementTotals`), the bank file's total (`lib/payment-file.ts`, which already adds whole kobo). **These are already correct.** A sum of two-decimal amounts is itself a two-decimal amount, so floating-point dust is always rounded away. I checked it: 6,600 random lists of up to 30,000 amounts, **0** came out different from the exact total. I leave these alone, except where a file has its own copy of the rounding (section 4).

**Kind 2: multiplying or dividing.** This is where the exposure is, and it is the same tie problem as before: an exact half-kobo that floating point stores a hair low.

**Kind 3: display and non-money numbers** (percentages, days, factors, ratios used for warnings). Not touched.

## 2. Measured (Kind 2)

I took each calculation written the way the service writes it, ran it over millions of synthetic amounts, and compared it with exact half-up arithmetic in whole kobo.

| Calculation | Where | Differs from exact | Example (by hand) |
| --- | --- | --- | --- |
| **Overtime pay**: hours × hourly rate | `inputs.ts` | **2.94%** (33,585 of 1,142,880) | 0.5 h × ₦256.21 = 128.105 → exact ₦128.11, today ₦128.10 |
| Recurring percentage deduction | `payroll.ts` | 0.27% | ₦51,254.50 × 1% = 512.545 → exact ₦512.55, today ₦512.54 |
| Leave encashment (leaving settlement) | `eos.ts` | 0.35% | 2.5 days of ₦50,020.74 ÷ 30 = 4,168.395 → exact ₦4,168.40, today ₦4,168.39 |
| Arrears: corrected amount | `inputs.ts` | 0.34% | ₦52,043.85 × 1/30 = 1,734.795 → exact ₦1,734.80, today ₦1,734.79 |
| **Loan instalment (rounds UP)** | `lib/loans.ts` | 0.40% | ₦262,976.78 in one instalment: should be ₦262,976.78, today ₦262,976.79 |

**What I checked, not assumed:** every difference in the first four rows is a tie, and today's answer is always the lower one; the largest is 1 kobo. The loan row is a different bug: its "round up" can tip over by 1 kobo when the division is exact, so an instalment can be a kobo more than it should (the amount actually deducted is capped at what is still owed, so a loan is never over-recovered, but the stored instalment is wrong).

**Overtime is the one to notice.** Half-hour steps times an odd-kobo rate land on a tie often, and overtime is paid to the employee. Across all of these, the amounts that move are ₦0.01 each.

**Limits:** synthetic amounts; I have not run the services on real data, and I have no golden dataset.

## 3. The design

**The engine's boundary stays as it is** (naira numbers in and out, read through `koboFromNaira`, which refuses a part-kobo amount). Section 6, question 2, explains the alternative. Inside each service the arithmetic becomes whole kobo with `mulPct`, `mulDiv` and `Exact`, rounded half up once at the line.

**4a: pay inputs and the bank file**
- **Overtime** (`inputs.ts`): hours × the stored hourly rate as an exact fraction, rounded once. The entry's tolerance check (the entered amount may differ by up to a kobo) becomes an exact comparison.
- **Arrears** (`inputs.ts`): the corrected amount (gross × the paid fraction), the pensionable part (difference × pension base ÷ earned gross, as an exact fraction), the pension and tax impacts. `computePaye` already works in kobo underneath.
- **Recurring percentage deduction** (`payroll.ts`): `mulPct`.
- **Run totals and batch totals** (`summarize`, `payments.ts`): added in whole kobo, so the code stops using `round2` for money. The values do not change (Kind 1).
- **Bank file** (`lib/payment-file.ts`): reads each amount strictly. Today a part-kobo amount is silently rounded in the file the bank sees. After: it is listed as a **problem** ("not a whole number of kobo") and left out unless you choose to leave problems out, like a bad account number. The total stays whole kobo.
- `rates.ts` (`round2(num(...))` on a value that is already two decimals) and the quick-payslip service tidy-ups.

**4b: leaving settlements and loans**
- **`lib/eos.ts` and `settlements.ts`**: every amount is worked as an exact fraction and rounded once. **I keep every rounding choice that exists today** (the choices are business rules, so I do not change them):
  - leave days are rounded to two decimals before they are multiplied by the daily rate;
  - years of service are rounded to two decimals before gratuity;
  - the daily rate shown on a line is rounded, but the amount is worked from the unrounded rate;
  - the basic part of the monthly gross is `gross × basic share`, rounded to the kobo.
- **`lib/loans.ts` and `loans.ts`**: the instalment is the principal over the count **rounded UP to the kobo, done exactly** (so ₦262,976.78 in one instalment is ₦262,976.78). The affordability limits compare in exact kobo: a loan or advance is allowed up to the limit rounded half up to the kobo (today's `+ 0.005` guard does the same job with a float).

**Not touched:** the engine, PAYE, the finance ledger, billing, the CRM, pricing, reports, the sales and health-check tools, and any page layout.

## 4. Order of work (tests first), each part its own pull request

1. **Tests that fail on today's code**: the hand-worked ties above (overtime, recurring deduction, leave encashment, arrears, loan instalment), a gratuity case, a notice-pay case and a severance case, each worked by hand and checked against an independent BigInt calculation; plus a grid of a few thousand random cases per calculation.
2. **Tests that must keep passing unchanged**: all existing service and unit tests for these areas (overtime, arrears, deductions, loans, settlements, payment file).
3. **Refusal tests**: a part-kobo amount in the bank file, in an overtime entry and in a manual settlement line.
4. **The before-and-after**: seed the test database with the old code and then the new, and compare every payroll record, overtime entry, arrears record and settlement, as I did for PAYE and the engine. The seed has overtime and arrears, so differences will show. Every difference is listed with its working. If I see anything other than a 1 kobo tie, I stop and tell you.
5. Release notes, rule 2 status, data dictionary (no schema change expected).

## 5. What this does to existing numbers

- **Overtime entered from now on** is about ₦0.01 higher in roughly 3 in 100 entries (the ties). Arrears, recurring percentage deductions and leave encashment: about 3 in 1,000.
- **Loan instalments**: a kobo lower in the 0.4% of cases where today's is a kobo too high.
- **Locked and paid payrolls, issued payslips, exported bank files and approved settlements are never recalculated.** Pending (unlocked) records recalculate when next calculated.
- No migration, no dependency, no change to stored data.

## 6. What I need from you

1. **Scope.** This pass covers the pay path above. Finance, billing, the CRM, pricing and reports are not included (there are 282 more `round2` calls in them, most of them sums, which are already correct). Please confirm, or tell me to plan them as a separate phase.
2. **The engine's boundary: keep it as numbers (recommended), or change it to whole kobo throughout?** The services already read a stored two-decimal amount exactly, and the boundary refuses anything else, so keeping it is safe and small. Changing the engine's inputs and results to a kobo type is cleaner but touches every service and the 32 places the engine is called from (services and tests), plus their inputs and results, for no change in any figure. I recommend keeping the boundary and calling `koboFromNaira` what it is: how a stored amount is read. Please say if you want the larger change.
3. **Loan instalment rounds UP.** It is the only rule in the pay path that is not half up, and a loan instalment is deliberately never less than needed so the last one is not larger. I keep it and make it exact. Is that the rule you intend?
4. **Overtime goes up by a kobo on ties** (about 3 entries in 100). Please confirm that is right, and a hand check of one: 0.5 hours at ₦256.21 is ₦128.105, which half up makes ₦128.11.
5. **A part-kobo amount in the bank file becomes a listed problem** instead of being rounded silently. OK?
6. **Settlement rounding choices that I keep unchanged** (leave days and years of service to two decimals; the shown daily rate rounded but the amount from the unrounded rate). Please have the adviser confirm these are the intended rules: they are the sort of rule I must not guess at.
7. **Still open from before:** negative rounding in general (assumed half away from zero), your hand check of a tie (₦8,791.095 or ₦2,108.195 or ₦128.105), the golden CSV, the adviser on the NHF relief, whether ITF and NSITF should use the payslip's earned gross, whether real structures use FORMULA components, the ESLint rule (stage 5), the independent reviewer's GitHub username, and whether the engine should keep refusing part-kobo input.

## 7. Risks and what I will not do

- Overtime is paid to employees. That is why the before-and-after comes first and why I list each difference.
- A part-kobo amount that now stops an operation (bank file row, overtime entry) could surprise a user. The messages will say what to fix.
- I will not change any policy rule, rate, loan limit or settlement rule, and I will not touch locked or paid records.
- I will not start 4b until 4a is merged.
