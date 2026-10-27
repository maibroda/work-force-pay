# Plan: exact money arithmetic in the pay path

**Status: stage 1 built (`src/lib/money-exact.ts` and `tests/unit/money-exact.test.ts`, 39 tests), on your "go for stage 1". Nothing uses it yet. Stages 2 to 5 are a plan and wait for your "go" each.** Pay and statutory code needs your written "go" first (`CLAUDE.md`).

**Rule it serves:** rule 2 (money is integer kobo or exact decimals, never floating point, rounded half up to the kobo at the line where the amount is calculated, in ONE shared utility with tests).

## 1. What exists today

- The database stores money exactly (`Decimal(14,2)`). That part is fine and stays.
- Every calculation first turns the stored value into an ordinary JavaScript number (`num()` in `src/lib/money.ts`), does the arithmetic in floating point, and rounds each result with `round2`.
- `round2` is half away from zero with a tiny nudge (`+ Number.EPSILON`). For positive amounts that is the same rule as "half up". For negative amounts (reversals, recoveries) it differs from "half toward plus infinity"; see question 1.
- There is one shared `round2`, but there are also **three more private copies** (`appraisal.ts`, `crm.ts`, `pricing.ts`) and the same rounding written inline in `payroll/formula.ts`, `client-inputs.ts` and the services I added.
- Pay-path files that do money arithmetic: `src/lib/payroll/engine.ts`, `paye.ts`, `structure.ts`, `formula.ts`, `quick-payslip.ts`; `src/lib/eos.ts` (leaving settlements), `src/lib/pension-summary.ts`; and the services `payroll.ts`, `payment-file.ts`, `payslips.ts`, `settlements.ts`, `loans.ts`, `payroll-controls.ts`.
- Rates are held as percentages with up to four decimal places (`Decimal(7,4)` for most, `Decimal(6,3)` for pension). PAYE annual tax is added up unrounded and rounded **once**, when it becomes a month.

## 2. What goes wrong, measured

I measured it before proposing anything. For each rate I took about 20.7 million amounts between ₦50,000.00 and ₦1,500,000.00, calculated the line the way the engine writes it (`round2((amount × percent) / 100)`, or `round2((amount × days paid) / days in month)`), and compared it with the exact answer worked out in whole kobo and rounded half up.

| Calculation | Lines where today's answer is 1 kobo off | Example |
| --- | --- | --- |
| Employee pension 8% | 0 | |
| Employer pension 10% | 0.59% (122,465) | ₦50,001.05 → exact ₦5,000.11, today ₦5,000.10 |
| NHF 2.5% | 0.15% | ₦50,009.80 → exact ₦1,250.25, today ₦1,250.24 |
| ITF / NSITF 1% | 0.05% | ₦51,242.50 → exact ₦512.43, today ₦512.42 |
| PAYE band 15% | 0.32% | ₦54,638.90 → exact ₦8,195.84, today ₦8,195.83 |
| PAYE bands 18%, 21%, 23% | 0.06% to 0.10% | ₦71,241.50 → exact ₦16,385.55, today ₦16,385.54 |
| Operative's 70% share | 0.45% | ₦50,002.45 → exact ₦35,001.72, today ₦35,001.71 |
| Management's 30% share | 0.64% | ₦54,615.45 → exact ₦16,384.64, today ₦16,384.63 |
| Proration (paid days ÷ 30) | 0.71% (483,963 of about 68 million) | ₦50,000.55 × 5/30 → exact ₦8,333.43, today ₦8,333.42 |
| Proration (paid days ÷ 31) | 0 | |

**Checked, not assumed:** across the 1,017,292 disagreements in a further run (which also covered 7.5%), every one was a tie, every one rounded **down**, and the largest error was exactly 1 kobo.

**What this means.** Every mismatch is a tie: the exact answer ends in half a kobo, and floating point stores the number a hair below it, so it rounds down instead of up. The error is never more than 1 kobo on a line. Across a payroll of 3,000 people with roughly ten rounded lines each, I'd expect on the order of a hundred lines to be ₦0.01 away from a hand calculation, and the payroll total to drift by a naira or two. That is small, but it is real, it is not random (it always errs downward on a tie), and it means the app can disagree by a kobo with a spreadsheet, an adviser or the tax authority doing the same sum with half-up.

**Limits of this measurement.** I modelled the engine's own arithmetic on synthetic amounts; I did **not** run the real engine on real payroll data, and I have no golden dataset to compare with. The percentages depend on the mix of amounts, so treat them as indicative. The finding itself (ties round the wrong way) is certain; how often it appears in a real payroll is an estimate.

## 3. The design

**One new file, `src/lib/money-exact.ts`**, the only place money is rounded:
- Money inside a calculation is a whole number of **kobo** (a JavaScript integer; safe up to about ₦90 trillion). It enters through `toKobo()`, which reads a stored `Decimal` or a text amount and **refuses** anything with more than two decimal places, and leaves through `fromKobo()` when saved or shown.
- Rates enter through `pctToUnits()`, which reads a percentage as text (for example "7.5") into whole units of one ten-thousandth of a percent. Nothing is ever a floating-point fraction.
- `mulPct(kobo, rate)` and `mulDiv(kobo, top, bottom)` multiply and divide using whole-number arithmetic (BigInt inside, so nothing overflows) and round **half up** once, to the kobo, at the line being calculated.
- `sumKobo()` adds whole numbers: no rounding, no drift.
- PAYE: the band slices are multiplied by their rates exactly and added up as exact fractions; the sum is divided by 12 and rounded **once** (as today).

**Everything else keeps its shape.** The engine stays a pure function with the same inputs and the same lines; only the type of number inside changes. The database, screens and files are unchanged.

## 4. Stages (each one: tests first, full suite, then a before-and-after comparison)

0. **Branch and safety net.** A branch for the work; a snapshot of today's output for a seeded dataset (the demo client's months and the demo organization's), kept as a "before" file.
1. **`money-exact.ts` and its tests only.** Tests first: every tie case in section 2 becomes a test that **fails on today's `round2` and passes on the new one**; plus negative amounts, large amounts, rates with four decimals, and refusal of a value with sub-kobo digits. Nothing else changes.
2. **Statutory:** `paye.ts`, `pension-summary.ts`. Tests first (PAYE worked by hand for several salaries across every band).
3. **The engine:** `structure.ts`, `formula.ts`, `engine.ts`, `quick-payslip.ts`. Tests first. The "before and after" comparison runs here: for every employee-month in the seeded data, old and new results are compared line by line. **I expect differences only of ±1 kobo, only at ties, and I will list every one with its working.** If I see anything else I stop and tell you (your STOP conditions).
4. **The services that use the engine:** `payroll.ts` (writing results back as `Decimal` from kobo), `payroll-controls.ts`, `payment-file.ts`, `payslips.ts`, `settlements.ts` and `eos.ts`, `loans.ts`. Tests first. The bank file's total must equal the sum of its lines, to the kobo, as a test.
5. **Tidy-up:** the private `round2` copies and inline `Math.round(x*100)/100` in the payroll path are removed. Money outside payroll (the finance ledger, billing, the CRM and pricing tools) is **not** in this plan (see question 2).

Each stage is its own branch and pull request, so you can review and stop at any point.

## 5. Database and existing payrolls

- **No migration.** Storage is already exact, and no stored data is rewritten.
- **Locked and paid payrolls are never recalculated**, so they keep exactly what they had.
- A payroll that is **not yet locked** will come out ₦0.01 different on some lines the next time it is calculated. A client who compares a draft calculated before and after may notice; the explanation is above. (Nothing is in production yet, so this affects only demo and test data today.)

## 6. Risks and what I will not do

- A change to the engine is a change to every pay figure. That is why stage 3 is a line-by-line comparison and not just a test run.
- BigInt arithmetic is slower than plain numbers. I will time a 3,000-person calculation before and after (rule 12 has no test today; this adds the first).
- I will not touch tax rates, the salary structure rules, or any business rule. If the comparison shows something that looks like a rule problem rather than a rounding one, I stop and ask.
- I will not claim a security or correctness property I haven't tested.

## 7. What I need from you

1. **Rounding of negative amounts.** The app today rounds half **away from zero** (−2.345 becomes −2.35), which is the usual payroll convention and keeps a reversal exactly equal to the original. "Half up" read literally (toward plus infinity) would make −2.345 become −2.34, so a reversal could differ from the original by a kobo. **I recommend half away from zero** (round half up on the size of the amount). Please confirm, or say otherwise.
2. **Scope.** I recommend this phase covers the payroll pay path, statutory calculations, leaving settlements, loans and the bank file, and leaves the finance ledger, billing, CRM and pricing for a later phase. Please confirm.
3. **Existing unlocked payrolls** may move by a kobo on recalculation (section 5). Please confirm that is acceptable.
4. **A hand check of the rule.** Please check three of the ties in section 2 with a calculator or spreadsheet (for example ₦50,002.45 × 70%) so that you, and not I, confirm what "right" means for them.
5. **Your golden dataset**, when you have it. Until then the "before" snapshot is my own seeded data, and I will say so in the report.
6. **An ESLint rule** that forbids the pattern `Math.round(x * 100) / 100` outside `money-exact.ts`, so it can't creep back. This is a lint configuration change, not a CI change. May I add it in stage 5?

## 8. Alongside, from your message

- **CODEOWNERS:** your handle is `maibroda`. I still need the independent reviewer's GitHub username. I will propose the list of critical paths for you to approve (the engine, statutory, approvals, audit, access control and bank-file files) once I have it.
- **Order you set:** exact money arithmetic, then a block on payroll runs when a required statutory setting is unverified, then auditing of failed logins. I'll plan each in turn, and wait for your "go" at each.
