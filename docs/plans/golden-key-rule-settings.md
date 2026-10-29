# Plan: default decisions for the five differences between the golden key and the engine (as editable settings)

**Status: step 1 (the setting) and step 2 (the NHF deduction) are BUILT on branch `nhf-deduction`, after the founder said "apply what is global world practice standard golden-key applicable in Nigeria": the key's own 2.5% is the standard rate, kept as an editable payroll-rule setting (shipped at 2.5). **Corrected by the founder: NHF is VOLUNTARY, not compulsory, remitted by the end of the month, so it is taken only from employees who have chosen it (a per-employee choice with the date made), and no existing pay changes because nobody has chosen it.** Steps 3 (the net-pay floor, which the key itself calls a client-specific policy) and 4 (regenerating cases 4, 5 and 9) are NOT built.**

*Original status:* a plan for the founder's "go". Nothing in it had been built. It changes how employees are paid (payslips, net pay, the ledger), so `CLAUDE.md` says a plan and a "go" come first. It answers the founder's instruction to **make a default decision on each open question and make it editable**, instead of waiting for the adviser. The defaults below change **no existing pay figure**: each one is a setting whose shipped value is what the engine does today.

**Rules it serves:** rule 2 (exact money, one rounding rule), rule 3 (rules are effective-dated data, not code), rule 4 (golden tests), rule 15 (honesty). It finishes the five `it.todo` lines in `tests/golden/golden.test.ts`.

## 1. The five differences, and what I verified

The golden key (`tests/golden/`) and the payroll engine agree on gross, pension and PAYE wherever they can be given the same inputs. They differ in five places (see PR #80). I re-read the code for this plan:

- The engine's pay is **one monthly gross per site, split by percentages across the salary structure's components** (`RateInfo.monthlyGross` and `StructureDef` in `engine.ts`). There is **no separate "allowances on top of a rate"** in the engine. The key's cases are written as "a rate plus allowances", so differences 3, 4 and 5 below come from that modelling choice, not from an arithmetic error on either side.
- The engine has **no employee NHF deduction**; NHF appears only as a PAYE relief (computed from basic) and as an employer-side cost.
- The engine only **flags** deductions above `maxDeductionPctOfGross`; it never reduces them.
- The ledger posts **each payslip line to its own head** through the Payroll GL Mapping, and an unmapped head falls back to "Other deductions" with a warning (`accounting.ts`). So a new deduction line is postable once it has a mapping.

## 2. The default decision for each, and how it is edited

| # | Difference | Default decision (what ships) | How it is edited | What changes in pay when it is switched on |
| --- | --- | --- | --- | --- |
| 1 | **NHF**: the key takes 2.5% of basic off net pay; the engine takes nothing | **Built, voluntary.** Payroll-rule setting `nhfEmployeeRatePct` (shipped **2.5**) applied only to employees marked as contributing (`Employee.nhfContributes`, with the date chosen); due at the end of the month. | A new payroll rule version from a date (effective-dated, audited, like every payroll rule). | A deduction line "NHF" of the rate on basic, rounded half up to the kobo; PAYE relief then uses the **actual** amount deducted (the PAYE code already accepts it); net pay falls by that amount. Needs a ledger mapping for the NHF head (the chart already has "NHF / Medical Payable") and an NHF remittance type (a migration). |
| 2 | **Net-pay floor**: the key stops loans and cooperative deductions taking more than half of gross | **Off.** New setting `minTakeHomePctOfGross`, default **0** (today: a warning above `maxDeductionPctOfGross`). | Same payroll rule version. | Loan and cooperative deductions are limited so take-home stays at least that share of gross; what is not taken is **carried to the next month, not lost** (the loan schedule and the cooperative balance must show it). This is the part that needs the most care. |
| 3 | **Allowances during unpaid absence**: the key does not reduce allowances for absence days | **Keep the engine's rule.** Allowances are salary-structure components, reduced with the days paid. | Not a setting. Instead the **key is regenerated** for case 4 (see section 3). | None. |
| 4 | **Overtime base**: the key uses the rate without allowances; the app uses the whole operative gross | **Keep the app's rule.** | Existing settings (`overtimeMultiplier`, `standardHoursPerDay`) already edit the rate; the key is regenerated for case 5. | None. |
| 5 | **Rounding**: the key rounds basic pay and allowances as two lines; the engine rounds each component | **Keep the engine's rule** (each salary component rounded half up to the kobo, then added). | Not a setting; the key is regenerated for case 9. | None. |

**Why 3, 4 and 5 are "regenerate the key" and not settings.** They follow from the key describing pay as "rate plus allowances", which the salary structure model does not have. Making the engine imitate that would add a second pay model for the sake of eleven test rows. `GOLDEN_FORMAT.md` section 2 itself says: "If your engine uses different rules, change the rule in one place and regenerate the key, do not tweak individual expected values." The founder keeps the right to choose the other way (a setting per difference); I recommend against it.

## 3. How the golden tests then settle

- `golden.test.ts` already loads the key's parameters. It will build the engine's settings **from those parameters** (NHF rate 2.5%, minimum take-home 50%), as `GOLDEN_FORMAT.md` section 4 describes, and compare **net pay too** for the cases where the engine's model and the key's agree (1 to 3, 6 to 8, 10, 11: nine of eleven).
- For cases 4, 5 and 9 the reference calculator gets a second, clearly named variant, "structure model", that follows differences 3 to 5 as decided above; **the founder approves the regenerated expected values** (they are hand-checkable; for example case 9's gross becomes 73,333.33, which is what the engine gives today, instead of the key's 73,333.34; the PR will show the worked numbers for all three). Until approved, those three stay `it.todo`.
- No expected value is edited to make a test pass; the key's file changes only by that explicit decision, and the diff is the review.

## 4. Order of work (tests first, each its own pull request, each waits for "go")

1. **Settings and golden settings loader** (no pay change): the two payroll-rule fields with default 0, their screen, copy to new organizations, the golden test reading them.
2. **NHF deduction** (difference 1): line, relief from the actual amount, net pay, payslip, ledger mapping, remittance, tests including exactness at ties and isolation. Seeded and demo figures must be identical with the setting at 0 (I will compare before and after, as for the exact-money work).
3. **Net-pay floor** (difference 2): capped deductions and the carry-forward, loans and cooperative balances, tests.
4. **Regenerate cases 4, 5, 9** with the founder's approval; the three todos become tests.

## 5. Questions for the founder

1. **Confirm the defaults**: NHF off and net-pay floor off until the adviser confirms; differences 3 to 5 resolved by regenerating the key under the structure model.
2. **NHF** (adviser): who it applies to, the rate and base (the supplied files say 2.5% of basic and "applies by default"), and whether the PAYE relief is the amount actually deducted. I will not assume.
3. **Net-pay floor**: is a carry-forward of the unrecovered part what you want, or should the part not taken simply wait for a later month's room (the same thing, different wording on the payslip)? And is 50% of gross the right floor for the bureau's clients, or a per-client setting?
4. **Cases 4, 5 and 9**: approve regenerating them under the structure model, or ask for a per-difference setting instead.

## 6. Risks and what I will not do

- Switching NHF on changes every employee's net pay and creates a liability to remit; it needs the adviser's confirmation and a payroll rule version with a start date, never a silent change.
- The net-pay floor interacts with loans, cooperative deductions and the maker-checker approval of deductions; it is the riskiest part and is built last.
- I will not change any seeded or existing pay figure, enter any statutory value from memory, or edit the golden key without your approval.
