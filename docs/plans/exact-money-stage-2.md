# Plan: exact money, stage 2 (PAYE and the pension summary)

**Status: built on the founder's "go for stage 2", with questions 1 and 2 of section 7 answered: (1) yes, the `"2000.205"` pension-summary test case is replaced by a test that such a value is refused; (2) PAYE changes in place.** PAYE is a statutory module, so `CLAUDE.md` required your "go" before I touched it. Stage 1 (`src/lib/money-exact.ts`, merged in #65) is the tool this stage uses.

**Rule it serves:** rule 2 (exact money, one half-up rounding rule). Rule 4 (tests first) governs the order of work.

## 1. What exists today

| File | What it does | Who calls it |
| --- | --- | --- |
| `src/lib/payroll/paye.ts` (150 lines) | `computePaye`: annualises the month, applies reliefs, taxes the slices of income in each band, returns the month's PAYE. `taxOnBands`: tax on an annual amount. | `payroll/engine.ts` (3 calls: normal run, and before/after for a supplementary run), `payroll/quick-payslip.ts`, `services/inputs.ts` (2 calls, arrears tax estimate), tests |
| `src/lib/pension-summary.ts` (10 lines) | `employeePensionYtd`: adds up the pension deducted from an employee in a calendar year. | `app/(app)/me/page.tsx` |

How PAYE is worked out today, all in ordinary floating-point numbers:
1. Annual regular income is the month's regular taxable × 12. Annual irregular income (overtime, arrears, one-offs) is added as it stands.
2. Each relief is worked out and rounded to the kobo on its own line (pension × 12; rent relief 20% of annual rent capped at ₦500,000; NHF fallback; and so on). The rounded reliefs are added up.
3. Tax on the regular income is the sum of (slice × band rate) over the bands, **not rounded**.
4. One-off income is taxed at the marginal rate on top: tax(regular + irregular) − tax(regular).
5. Monthly PAYE = regular tax ÷ 12 + the one-off tax, rounded **once**. `annualTax` is rounded separately.

## 2. What goes wrong, measured

I ran today's real `computePaye` (with the seed bands and the pension and rent reliefs) against an exact whole-kobo version over **7,452,831 synthetic employee-months** (regular taxable pay from ₦50,000 to ₦4,000,000, roughly half of them with one-off pay and roughly half with rent).

| Result | Count |
| --- | --- |
| Same answer | 7,426,965 |
| Different by 1 kobo | **25,866 (0.347%)** |
| Different by more than 1 kobo | 0 |
| Of the differences: every one a tie (exact answer ends in half a kobo) | 25,866 of 25,866 |
| Of the differences: today's answer was lower | 25,866 of 25,866 |

**Worked by hand** (so you can check it): regular taxable ₦69,286.70, one-off ₦17,137.57, employee pension ₦2,217.17, no rent.
- Annual regular ₦831,440.40 less annual pension ₦26,606.04 = ₦804,834.36 chargeable. Tax: ₦4,834.36 × 15% = ₦725.154.
- With the one-off added: ₦821,971.93 chargeable. Tax: ₦21,971.93 × 15% = ₦3,295.7895.
- Monthly PAYE = ₦725.154 ÷ 12 + (₦3,295.7895 − ₦725.154) = ₦60.4295 + ₦2,570.6355 = **₦2,631.065**, exactly half a kobo.
- Half up gives **₦2,631.07**. Today's engine gives ₦2,631.06.

**Limits:** synthetic amounts, one rule set (the seed bands). I did not run it on real payroll data, and there is no golden dataset to compare with.

## 3. The design

**PAYE is changed in place, with the same function names and the same inputs and outputs (naira numbers).** Inside, the arithmetic is whole kobo. No second PAYE implementation is left lying around.

- **Coming in.** Each naira number is turned into whole kobo by a small private function in `paye.ts`. It accepts a number only if it is within a hair of a whole kobo (floating-point dust such as 84,000.00000000001 from earlier arithmetic) and **refuses** anything that is genuinely part-way through a kobo. The rule data (band edges, rates, caps) is converted the same way, rates through `pctToRate`. This private function is a temporary bridge. It goes in stage 3, when the engine passes kobo directly.
- **Each relief** is worked out and rounded to the kobo on its own line, exactly where it is today, using `mulPct`. Pension and NHIS are the month's amount × 12 (exact). A cap is whole kobo.
- **Band tax** is added up as exact whole numbers: for each slice, kobo × rate units. Nothing is rounded until the end.
- **The month's PAYE** is those exact totals combined (regular tax ÷ 12 plus the one-off tax) and rounded **half up once**, as today. `annualTax` is rounded once from its own exact total, as today.
- **`taxOnBands`** keeps its name and returns naira rounded once to the kobo (it is only called by tests today).
- **Going out.** Results are converted back to naira numbers, because the engine and screens still expect them until stage 3. Converting back is the only use of `koboToNumber` here, and it is flagged as temporary.
- **The exemption test** (annual gross at or below the ceiling) becomes an exact kobo comparison.
- **`employeePensionYtd`**: adds each stored pension amount as kobo, so a year of slips adds up exactly. It still returns a number for the screen.

**Not changing:** any rate, band, relief rule or exemption rule; what is relieved; the order of steps; the database; screens; the supplementary-run logic in the engine (it subtracts two PAYE results and stays correct).

## 4. Order of work (tests first)

1. **Tests that fail on today's code.** In `tests/unit/paye-exact.test.ts`: the hand-worked tie above and at least five more, each worked by hand and checked against an independent BigInt calculation, covering the 15%, 18%, 21%, 23% and 25% bands, one-off pay, rent relief and the NHF fallback. Every one of these must fail on today's code and pass on the new.
2. **Tests that must keep passing unchanged:** band edges (₦800,000 gives 0, ₦3,000,000 gives ₦330,000, and so on), the exemption at exactly the ceiling and one kobo above, zero and negative chargeable income, relief caps, the existing tests in `engine.test.ts`, `quick-payslip` unit and integration tests.
3. **A grid test** that checks `computePaye` against an independent exact calculation for a few thousand salaries, with and without one-off pay and rent.
4. **Refusal tests:** a number that is part-way through a kobo is refused with a plain message.
5. **A speed check:** 3,000 employees' PAYE (three calls each) timed and reported.
6. Implement. Then the full suite, ESLint and `tsc`.
7. **A before-and-after on the demo client** (30 employees, one month): old and new payroll run, every differing line listed with its working. I expect none, or a 1 kobo tie on PAYE, and I will stop and tell you about anything else.
8. Release notes and the data dictionary (no schema change, so no dictionary change expected).

## 5. What this does to existing numbers

- On synthetic data about **1 in 290** employee-months has PAYE 1 kobo higher than today's engine. Net pay for that employee is 1 kobo lower.
- Locked and paid payrolls are never recalculated. Unlocked ones may move by that kobo.
- No migration. No dependency. No change to stored data.

## 6. Risks and what I will not do

- **The tie rule is my reading of "round half up".** I need your hand check (see 7).
- **Mixed arithmetic until stage 3.** After this stage PAYE is exact, but the engine's other lines (pension, proration, shares) still use floating point. Only PAYE ties are fixed. I will say so in the report.
- I will not touch rates, bands, reliefs or exemptions, and I will not "correct" any rule from memory.
- I will not change the pension rule, the engine, or any service.

## 7. What I need from you

1. **A test I would have to change.** `tests/unit/pension-summary.test.ts` feeds `employeePensionYtd` the value `"2000.205"` and expects it to be rounded. The database can never hold that value (money is stored to 2 decimal places), and the strict reader refuses it. I recommend I **replace that one case** with a test that such a value is refused, and keep the other cases untouched. `CLAUDE.md` says I must not change a test without asking, so please say yes or no. If no, I will keep a lenient reader just for this function.
2. **Approach.** Change PAYE in place with a temporary bridge (recommended), or add a separate exact PAYE beside the old one and switch the engine over in stage 3. In-place means this stage already moves live PAYE by the tie kobo, but leaves no duplicate code.
3. **A statutory question I will NOT change but you should know about.** The seed rule gives an **NHF relief of 2.5% of basic pay × 12** to every employee, and the engine never passes in an actual NHF deduction (`nhfMonthly` is never set), so the relief is granted whether or not NHF is deducted. I keep this exactly as it is. Please have the adviser confirm it is intended; it belongs with the "verified statutory settings" work that comes next.
4. **Still open from stage 1:** negative-amount rounding (I assumed half away from zero), your hand check of one tie (₦2,631.065 above is the easiest), the golden CSV, the ESLint rule for stage 5, and the independent reviewer's GitHub username for CODEOWNERS.

## 8. Not in this stage (suggestions only)

- `annualTax` and monthly PAYE × 12 can differ by up to 6 kobo because each is rounded once on its own. That is how it works today; I preserve it and flag it so nobody is surprised.
- Pension rates, the engine's own lines, services and the bank file are stages 3 and 4.
