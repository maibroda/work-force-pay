# Plan: exact money, stage 5 (tidy-up and a guard so it stays that way)

**Status: built on the founder's "go for stage 5".** The "go" did not answer the questions of section 4, so I took my recommendations: the ESLint rule in `eslint.config.mjs` is added; `round2` is forbidden in the pay-path files; appraisal scores stay on the exceptions list; phase 6 (the sales and finance tools) is not part of this stage. Original status: a plan for the founder's "go". It is small and changes no pay figure, but it adds an ESLint rule, which is a change to the lint configuration, so `CLAUDE.md` says to tell you first.

**Rule it serves:** rule 2 ("put the rule in ONE shared utility") and rule 10 (do not change CI settings without telling you; the lint rule is not a CI setting, but CI runs `npm run lint`, so it applies there).

Stages 1 to 4 are merged (#65, #67, #69, #70, #72, #73): the whole pay path is exact. This stage removes what is left over on that path and adds a guard against it coming back.

## 1. What is left

I searched the whole source for private rounding helpers and for the inline `Math.round(x * 100) / 100` pattern. A lint rule that flags that pattern would flag **26 places in 17 files today**. They fall into four groups.

| Group | Where | What it is | Changes a figure? |
| --- | --- | --- | --- |
| **A. Pay path** | `lib/client-inputs.ts`, `services/client-inputs.ts` (the monthly inputs a client uploads) | Adding up amounts that the upload already limits to two decimals. | No (sums of two-decimal amounts are already correct; I tested 6,600 lists) |
| | `lib/payroll/quick-payslip.ts`, `quick-payslip-form.tsx`, `services/quick-payslip.ts` | Percentages (Basic, Housing, Transport, others), rounded to four decimals | Not money; a tie could move a percentage in the fourth decimal |
| | `engine.ts` (hours), `structure.ts` (`percentageTotal`), `payroll.ts` (a display factor), `payments.ts` (remittance sums), `rates.ts` (a no-op) | `round2` used on hours, percentages and sums | No |
| **B. Sales and finance tools** | `lib/crm.ts` + `services/crm.ts` (commission), `lib/pricing.ts` (price, discount, overhead, margin, VAT), `cost-centers.ts`, `gl-posting.ts`, `tax-engine.ts`, `report-registry.ts` | Money, but not payroll | Yes, on ties (measured below) |
| **C. Not money** | `lib/appraisal.ts`, `services/appraisals.ts` | Appraisal scores and ratings | Could move a score by 0.01 at a tie |
| **D. Tests** | four test files | The expected values in tests | n/a |

Not counted in the 26 (they do not match the pattern): the integer-cents helpers `cents = Math.round(n * 100)` in the finance libraries (`journals`, `receipts`, `notes`, `statements`, `year-end`, `period-close`, `certificates`) and in two editors; and about 280 `round2` calls in finance, billing, CRM, pricing and reports, which are mostly sums.

**Measured (group B, synthetic amounts, hand-checkable):** the same tie problem as before. VAT at 7.5% on a monthly fee: **0.17%** of cases 1 kobo low (₦54,651.40 × 7.5% = 4,098.855, today ₦4,098.85). A 5/10/12.5% discount: **0.49%** (₦50,006.50 × 5% = 2,500.325). Overhead 15/20%: **0.17%**. Sales commission 10/15/20%: **0.31%** (₦50,000.65 × 10% = 5,000.065, today ₦5,000.06). Always 1 kobo, always low. I have **not** measured billing, receipts or the ledger.

## 2. The proposal (small)

**5a. One new helper and the pay-path clean-up** (no figure changes)
- `roundPlaces(n, places)` in `money-exact.ts`: **the one place a plain number that is not money is rounded** (a percentage, an hour count, a score). It reads the number as exact decimal text and rounds half up (half away from zero for a negative), through the same shared rule. Tested: `2.675` to two places is `2.68`, `1.005` is `1.01`, and so on.
- Group A: client-input sums use the exact total; the quick-payslip percentage split uses `roundPlaces`; hours, the structure percentage total and the display factor use `roundPlaces`; remittance sums use the exact total; the no-op in `rates.ts` goes. After this, **the pay path no longer uses `round2` at all.**
- Tests first: `roundPlaces` ties and negatives; the unchanged-value tests for each tidied site (so I can show nothing moved); and the quick-payslip percentage split against an independent calculation.

**5b. The guard** (a lint configuration change, which I am telling you about)
- A rule that **errors** on the inline patterns `Math.round(x * 100) / 100` and `Math.round(x * 10000) / 10000` in `src`, with the message "use the shared utility".
- A second rule that forbids importing `round2` in the pay-path files (the list in section 1, group A, plus the files from stages 2 to 4), so the legacy helper cannot creep back in there.
- A short, written **exceptions list** for the files in groups B and C, each with the reason ("sales/finance tool, not yet converted"), so nothing is silently exempt. A file comes off the list when it is converted.
- Tests are not covered by the rule. I will check the rule works by proving it flags a deliberate violation, and that the build, `tsc` and the full lint stay clean.

**Not touched:** any pay figure, the engine, PAYE, the services' behaviour, CI settings (the workflow file), branch protection, the integer-cents finance helpers.

## 3. What this does to existing numbers

Nothing on the pay path: every change is to a sum of two-decimal amounts or to a non-money number. The only possible movement is a percentage in the fourth decimal at an exact tie in the quick payslip's "other allowances" split, which I will list if it happens.

## 4. What I need from you

1. **Go for 5a and 5b as described?**
2. **The lint rule** changes `eslint.config.mjs`. Is that all right? (It is not the CI workflow, but CI runs `npm run lint`, so a violation fails CI.)
3. **Forbid `round2` in the pay-path files** as well as the inline pattern? I recommend yes.
4. **A separate phase 6 for group B?** CRM commission, pricing (about 19 rounding sites in a chain, like the engine), VAT, discounts and margins are money with the same 1 kobo tie exposure, and billing, receipts and the ledger are untested for it. They are outside the pay path you scoped, so I have not planned them. Do you want a phase 6, and in what order (I would suggest VAT and invoices first, because they are legal documents)?
5. **Group C** (appraisal scores, not money): leave as they are on the exceptions list (my recommendation) or move to `roundPlaces`?
6. **Still open:** negative rounding in general (assumed half away from zero), your hand check of a tie, the golden CSV, the adviser on NHF and the settlement rounding choices, the ITF/NSITF base, FORMULA components, whether the engine keeps refusing part-kobo input, and the independent reviewer's GitHub username (CODEOWNERS, rule 11).

## 5. Risks and what I will not do

- The guard can only catch the patterns it names. Someone can still write rounding another way; the rule stops the common one and the exceptions list makes the rest visible.
- I will not convert group B in this stage, and I will not touch the finance ledger.
