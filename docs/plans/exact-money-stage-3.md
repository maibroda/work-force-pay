# Plan: exact money, stage 3 (the payroll engine)

**Status: stage 3a merged (#69). Stage 3b (the engine, the quick payslip, the overtime rate and a PAYE kobo core) is built on the founder's "go for stage 3b, option A"; questions 2 to 4 and 5 to 7 are as taken in 3a, and the ITF/NSITF base (question 5) is unchanged. One departure from section 5: the tax rule is not prepared once per run, because the measured cost did not need it.** The "go for stage 3a" did not answer questions 1 to 7. 3a is the same under A or B, so I built it. For the questions that affect 3a I took the plan as written: question 2 (the new `exact-fraction.ts`) as yes, question 3 (two pull requests) as yes, and question 4 (formula `ROUND()` rounds a negative tie away from zero, -0.125 becomes -0.13) as yes. Please correct any of these. Original status: a plan for the founder's "go". This stage changes how every pay figure is calculated, and it contains **one payroll-rule decision that is yours** (section 4, question 1). `CLAUDE.md` requires your "go" before I touch the engine.

**Rule it serves:** rule 2 (exact money, one half-up rounding rule). Stages 1 and 2 (`money-exact.ts`, PAYE, pension summary) are merged (#65, #67).

## 1. What exists today

| File | Lines | What it does with money |
| --- | --- | --- |
| `src/lib/payroll/engine.ts` | 671 | `calculateEmployeePayroll`: builds segments from the work register, prorates components, pension, PAYE, deductions, net pay, the 70:30 split, employer add-on costs, allocation by beat. Also `overtimeHourlyRate`. |
| `src/lib/payroll/structure.ts` | 143 | `computeComponents` (each salary component for a month, scaled by paid days), `splitAgreedRate` (the operative's 70% of the client rate), `percentageTotal`. |
| `src/lib/payroll/formula.ts` | 126 | A small safe evaluator for FORMULA components (`+ - * /`, `%`, `MIN`, `MAX`, `ROUND`). |
| `src/lib/payroll/quick-payslip.ts` | 122 | The "quick payslip" calculator: splits a gross by percentages, pension, PAYE, net. |

Callers: `calculateEmployeePayroll` is called from `services/payroll.ts` (3 places); `quickPayslip` from `services/quick-payslip.ts`; `computeComponents` also feeds a sample on the structure page; `splitAgreedRate` is used by `services/rates.ts` and the rates page; `overtimeHourlyRate` by `services/inputs.ts`; `validateFormula` by `services/structures.ts`. Those services are **stage 4** and are not touched here.

## 2. How the engine rounds today (this matters)

The engine does **not** round each segment's components. It carries them **unrounded** through the segments and rounds late, in this order:
1. Each component for each segment is `gross × percent ÷ 100 × (paid days ÷ days in the month)`, unrounded.
2. The segment's gross, its client billing and its management share are rounded from the **unrounded** sums.
3. Components are added up **across segments by code, and only then rounded**. That rounded figure is the line on the payslip. `earnedGross` is the sum of those rounded lines.
4. Everything after that (pension, PAYE, deductions, net pay, employer cost) is worked from the rounded payslip lines.

So today the "line where the amount is calculated" is the **payslip line, after segments are added**. Floating point makes the unrounded values inexact, so ties can fall the wrong way.

## 3. Measured

I took the standard nine-component structure and 300,000 synthetic employee-months for each case (gross ₦50,000 to ₦350,000, 30- or 31-day month, random paid days), and compared today's calculation with two exact alternatives:
- **A. Keep the late rounding, but exact.** Carry each amount as an exact fraction, add across segments, round once at the payslip line.
- **B. Round each segment's component to the kobo first, then add.** (The most literal reading of "round at the line".)

| Case | A against today | B against today |
| --- | --- | --- |
| One segment | **0** employees differ | 0 differ |
| Two segments, same gross | **0** differ | **265,306 of 300,000 (88%)** have a component that differs; earned gross moves by up to **6 kobo** |
| Two segments, different gross | **28** differ, by 1 kobo | **256,847 (86%)** differ; earned gross moves by up to **6 kobo** |

**What this means.** Option A leaves almost every payslip exactly as it is today (and fixes the rare tie). Option B is a different payroll rule: for anyone who worked at two sites in a month, many payslips would move by a few kobo, and not only at ties. That is not my call, so I stop and ask (question 1).

**A quirk I found and did NOT change:** today the segment gross (which ITF and NSITF are worked from, and which the beat allocation uses) is rounded from the unrounded sum, while the payslip's earned gross is the sum of the rounded lines. For a single-segment employee these **differ in 62% of months, by up to 3 kobo** (300,000 synthetic months). Under option A I preserve this exactly. See question 5.

**Limits:** synthetic data, one structure. I have not yet run the whole engine, because the exact one does not exist. The whole-engine comparison happens in stage 3b (section 5), on the seeded payroll and on a few hundred synthetic scenarios, and I will list every difference.

## 4. What I need from you

1. **A payroll rule: A or B? (My recommendation: A.)** A keeps the late rounding and the payslips as they are, and removes the floating-point error. B is simpler to explain (every line is whole kobo from the start, and lines always add up), but it moves many two-site payslips by a few kobo and I'd want your decision and your adviser's view first. **Please answer A or B.**
2. **A new shared utility, `src/lib/exact-fraction.ts`** (about 70 lines, no dependency, fully tested): an exact fraction type used only for unrounded amounts inside the engine, with the final rounding done by `roundRatio` from stage 1. It is needed for option A and for FORMULA components (division makes exact fractions). OK?
3. **Two pull requests**: stage 3a (the fraction type, formulas, components, the 70:30 split) and stage 3b (the engine and quick payslip), each with its own "go". OK?
4. **Negative ties inside `ROUND()` in a formula.** Today it is JavaScript's rounding (−0.125 becomes −0.12). I would make it half away from zero (−0.125 becomes −0.13), the same as every other line. It only matters for negative amounts at an exact half. OK? (This is the same question as stage 1's negative rounding, still unanswered.)
5. **The 3-kobo quirk** (segment gross against payslip earned gross, above). Under option A nothing changes. Do you want ITF/NSITF worked from the payslip's earned gross instead? That would be a rule change, so I only list it.
6. **FORMULA components.** The seed has one, and tests use them. Do ThreeRoots' real structures use formulas? It tells me how much weight to put on them.
7. **Still open from before:** your hand check of a tie (₦2,631.065 or ₦2,108.195), the golden CSV, the adviser's answer on the NHF relief, the ESLint rule (stage 5), and the independent reviewer's GitHub username.

## 5. The design (assuming option A)

**Stage 3a: the pieces**
- `exact-fraction.ts` (new): an exact fraction of kobo (whole-number top and bottom). Add, subtract, multiply, divide, compare, smaller/larger, and `round()` through `roundRatio`. Division by zero is refused.
- `formula.ts`: the same parser and the same formulas. It evaluates in exact fractions: a number in the text (`2.5`) is read exactly, `%` is ÷100, `ROUND` rounds to the kobo half away from zero. `evaluateFormula(formula, numbers)` keeps its signature (numbers in, a number out) for validation and tests.
- `structure.ts`: components worked as exact fractions (`gross × percent ÷ 100 × paid days ÷ days`); `computeComponents` keeps its signature for the structure page and tests. `splitAgreedRate` becomes `mulPct` (the operative's share rounded half up). **This is employee-facing: about 0.45% of agreed rates at 70% are 1 kobo higher** (measured in stage 1: ₦50,002.45 at 70% is ₦35,001.715, so ₦35,001.72, not ₦35,001.71).

**Stage 3b: the engine**
- `engine.ts`: amounts are whole kobo; the unrounded flows (components, billing, management share, the allocation running totals) are exact fractions rounded where they are rounded today. The order of steps, the segment rules, the pension and the deduction rules are untouched.
- `paye.ts`: the work done in stage 2 is split into a kobo core (`computePayeKobo`) used by the engine, and the existing number-in, number-out `computePaye` kept as a thin wrapper for `services/inputs.ts`. The tax rule is prepared once per run, not once per employee.
- `quick-payslip.ts`: percentages split with `mulPct`, last component takes the remainder (as today), pension, PAYE (the kobo core), net.
- `overtimeHourlyRate`: gross ÷ days ÷ hours × multiplier, exact, rounded once.
- **The engine's inputs and results stay as naira numbers** (so `services/payroll.ts` is not touched). A temporary bridge converts at the edge; part-kobo input is refused with a plain message.
- **Correction to stage 2:** I said the PAYE bridge would go in stage 3. It cannot, because `services/inputs.ts` still passes numbers. **The bridge goes in stage 4**, when the services move.

## 6. Order of work, tests first

1. **Before changing anything, a "before" snapshot.** I run today's engine on a few hundred synthetic employee-month scenarios (one to three segments, overrides, a formula component, overtime, arrears, other earnings, deductions, the add-on cost rule, a supplementary run) and save every money output to `tests/characterization/` (synthetic, a few hundred KB). It is called *characterization*, not *golden*: it records what the code does today, it is **not** a statement that today's figures are right. Your golden CSV, when it comes, goes in `tests/golden`.
2. **Tests that fail on today's code**: the hand-worked tie cases (the ₦35,001.715 split; a proration tie; a formula tie; employer pension, ITF and NSITF ties; an allocation tie), each worked by hand and checked against an independent BigInt calculation.
3. **Tests that must keep passing unchanged**: all 22 existing engine tests, the quick payslip tests, the structure and formula tests.
4. **The comparison**: new engine against the snapshot and against the seeded payroll (as I did for PAYE): every differing line listed with its working. **I expect only 1 kobo ties; because later lines are worked from earlier rounded lines, I can see a tie flip carrying into a line or two after it (a few kobo on a total).** If I see anything else, or a difference I cannot explain by hand, I stop and tell you.
5. **Speed**: 3,000 employees through the engine, before and after, against the 10-minute target.
6. Release notes, rule 2 status, data dictionary (no schema change expected).

## 7. What this does to existing numbers

- Under option A: one-segment payslips unchanged on the measure above; two-segment payslips differ in about 1 in 10,000 and by 1 kobo.
- Employee-facing lines that can move by 1 kobo at a tie: the operative's gross (from the 70:30 split), employee pension at rates where ties occur, and (through those) PAYE and net pay. Employer-side lines (employer pension, ITF, NSITF, insurance, management share, client billing) move by 1 kobo at ties.
- Locked and paid payrolls are never recalculated. No migration. No stored data is rewritten.

## 8. Risks and what I will not do

- **The whole engine changes.** That is why the snapshot and the line-by-line comparison come first.
- **Speed.** Exact fractions are slower than plain numbers. I will measure before and after and report it.
- I will not change the 70:30 rule, the segment rules, the proration basis, the pension or deduction rules, any rate, or the 3-kobo quirk.
- I will not touch the services, the bank file, settlements or loans (stage 4).
- If your answer to question 1 is B, I will rewrite sections 5 to 7 and ask again.
