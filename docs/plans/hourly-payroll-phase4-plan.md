# Hourly pay, phase 4: the pay run reads approved hours (plan and decision brief)

Written 2026-11-20. **Plan only: nothing here is built and no rule below is a decision until the founder approves it in writing.** Phases 1, 2, 3 and 5 and the follow-ups are merged (#238 to #243): the hours arithmetic, hourly rates, how a person is paid, time entries with approval, the reports. **Phase 4 is the step that makes hourly pay real:** the pay run reads approved hours and approved rates, and an hourly person gets a payslip, pension, PAYE and the other statutory lines. It touches pay, tax, payslips and the audit trail, so it needs your decisions first. This note says plainly how the pay run works today, what phase 4 would change, and what I need from you. Two of the questions (H8 and H12) are for you or your tax adviser: I will not choose them.

## 1. How the pay run works today (read from the code)

1. **Earnings.** For each person the pay run builds "segments" (a site and a rate). For a monthly-paid person each segment pays `monthly gross x days paid / days in the month`, divided into components (Basic, Housing, Transport and so on) by a **salary structure**, which is a list of percentages that must total 100 (the seeded standard one is Basic 10, Housing 14, Transport 15, then Entertainment, Meal, Utility, Leave, Medical, Clothing). Each component is marked **taxable** and **pensionable**. (`src/lib/payroll/engine.ts`, `structure.ts`)
2. **Pension and NHF** are taken from the components marked pensionable (pension, at the rates in the effective-dated settings) and from Basic (NHF, voluntary).
3. **PAYE.** The month's **regular taxable pay is multiplied by 12** to get an annual figure; reliefs are taken off; the tax bands are applied; PAYE for the month is **a twelfth** of that tax (one-off amounts such as overtime, arrears and other earnings are taxed separately at the marginal rate on top). The bands and reliefs are effective-dated settings, never in code. (`src/lib/payroll/paye.ts`)
4. **Employer add-on costs** (ITF, NSITF, insurance, uniform and kits, and so on) are worked for guarding and outsourcing contracts. ITF and NSITF are a percentage of the person's gross; the others are a percentage of the **management share**, which is the client's agreed monthly rate for that person minus the pay and the statutory costs. (`engine.ts`)
5. **Deductions, net pay, payslip lines, allocation to sites** follow. After a payroll is locked, a correction is a supplementary payroll.

## 2. What phase 4 would change (design, one engine)

No second pay engine. For a person who is paid by the hour on the day, the earned gross comes from **their approved hours** instead of from `monthly gross x days`; everything after that is the existing code.

1. **A pure step** turns the approved paid pieces (phase 3) and the approved hourly rates (phase 2) into three lines per person, site and rate: weekday, weekend and public holiday hours, each priced once and rounded half up to the kobo once (the same lines the phase 5 reports show).
2. **The engine takes an optional "hourly earnings" input.** For an hourly person it builds one segment per site from those lines, splits the gross into components with the salary structure chosen under **H8**, and carries on unchanged: pension, NHF, PAYE (under **H12**), deductions, net pay, allocation to sites. A monthly person takes the existing path exactly as today; the golden datasets must pass unchanged.
3. **The pay run assembles the inputs:** the approved paid pieces in the pay month, the approved rates, the holiday calendar status, and who is paid by the hour. It raises **findings** (the existing mechanism) for: hours with no approved rate; shifts still waiting for approval or with no clock-out in the period ("unapproved attendance never enters a finalised payroll", and the finding tells the approver what is left out); a holiday year that was not confirmed; a site with no recognised state; a person who has both a personal monthly pay rate and an hourly record; and the minimum-pay warning (**H13**, your answer: a configurable figure you or your adviser enter, a warning only).
4. **The breakdown is stored** (a migration): for every payroll record, the hourly lines with the hours, the rate used and the amount, and which time entries they came from, so a later rate change can never alter a past payroll and every figure can be traced. (`HourlyPayLine`.)
5. **Payslip:** weekday, weekend and public holiday hours and earnings, total hours, gross, statutory deductions, other deductions, net pay (the request's section 7).
6. **Hours approved after the payroll is locked** go to a supplementary payroll (the existing mechanism).
7. **Tests first,** including: a mixed company (monthly and hourly in one run), a mid-month rate change, a shift over a month end, hours approved late, a person with no rate, historical reproduction after a later rate change, the golden datasets unchanged, and 3,000 hourly people in the time allowed (rule 12), run in CI.

Each of these would be its own pull request, tests first, with an explain-back note, and would stop for your approval.

## 3. Decisions I need

### H8 (yours or your adviser's): which salary structure splits an hourly person's gross

This decides the **pensionable base** and the **taxable amounts**, so it is a pay and tax matter. The engine already needs a structure for every paid person.

| Option | What it means | Consequence |
| --- | --- | --- |
| A. The structure of the person's job role / contract (as for monthly staff) | The hourly gross is split by the same percentages as a monthly person on that contract | Consistent with monthly staff; the percentages were agreed for a monthly package and may not suit hourly pay |
| B. One structure made for hourly staff, set by you | You define, once per company, how hourly earnings split (for example, which parts are pensionable) | Explicit and configurable; you or your adviser own the percentages |
| C. All hourly pay as one taxable, pensionable line | No split | Simplest; gives the largest pension and NHF base; may not match the contract |

I will build whichever you choose; I will not choose the percentages.

### H12 (your tax adviser's): PAYE on variable monthly pay

As in section 1, the engine treats a month's regular taxable pay as if it were earned every month of the year (x 12) and takes a twelfth of the tax. For a salaried person paid for part of a month this is what happens today. For an hourly person whose hours differ from month to month it means a busy month is taxed as if it were the person's usual month and a quiet month likewise. **I did not find a year-end reconciliation in the engine.**

| Option | What it means | Consequence |
| --- | --- | --- |
| A. The same method as monthly staff | Each month's earnings are treated as regular pay | Nothing new to build; the monthly tax can be higher or lower than the same person's tax if their pay were level |
| B. Treat hourly earnings as one-off income each month | The engine already has this path (used for overtime and arrears) | A different tax result; whether it is right is a legal question |
| C. A running year-to-date method | Tax each month on the cumulative position | A larger piece of work, not built today |

I cannot recommend a method: it is a tax rule. If your adviser says the existing treatment is wrong for variable pay, that is a change to the tax settings, not something I would invent.

### New decisions found while reading the code

| # | Question | My recommendation |
| --- | --- | --- |
| H19 | **Employer add-on costs for hourly staff.** ITF and NSITF are a percentage of gross and would work. The others (insurance, uniform and kits, recruitment and training, leave reliever) are a percentage of the "management share", which comes from the client's agreed **monthly** rate per person, and an hourly person has none. Without a rule they would come out as zero. | Needs you (and the client billing question H15): either the client agrees an hourly billing rate that the management share is worked from, or those costs are left out for hourly staff and shown as not applicable. |
| H20 | **A person with a personal monthly pay rate who becomes hourly.** The two are separate records today. | Refuse (a blocking finding) until the monthly pay rate has been ended, so a person is never paid both ways. |
| H21 | **Hours still waiting for approval when a payroll is calculated.** | They are left out, listed in a finding that the payroll approver sees; whether that finding **blocks** approval of the payroll or only warns is your decision. I recommend it blocks, because unapproved hours would otherwise be paid a month late without anyone choosing that. |
| H22 | **Hours approved after the payroll was locked.** | A supplementary payroll for those hours (the existing mechanism); confirm. |

Still open from before and needed by the later pieces: **H7** minimum hours, **H14** leave and sickness pay for an hourly person, **H15** hourly client billing, and where a budget would come from for budget against actual.

### Answered by the founder on 2026-11-20 (all as recommended)

| # | Answer |
| --- | --- |
| H20 | **A person with a personal monthly pay rate who is paid by the hour: block until the monthly rate is ended.** A blocking finding: the payroll cannot be approved while a person has both, so a person is never paid both ways. |
| H21 | **Hours still waiting for approval (or with no clock-out) when a payroll is calculated are left out, and block approving the payroll.** A blocking finding lists them for the payroll approver, who must get them approved or explicitly override with a reason (the existing override). Nothing is paid a month late by accident. |
| H22 | **Hours approved after a payroll is locked are paid in a supplementary payroll** (the existing mechanism); the locked payroll is never changed. |
| H15 | **Hourly client billing is out of scope for now.** Hourly pay is payroll cost only; the reports show cost per client and contract. |

**H19 follows from H15 and is for your confirmation.** With no hourly client billing there is no client monthly rate to work the "management share" from, so the add-on costs that are worked from it (insurance, uniform and kits, recruitment and training, leave reliever, outsourcing leave allowance) would be **not applicable** for hourly staff. ITF and NSITF are worked as a percentage of the person's gross by the existing rule and would still apply to an hourly person on a guarding or outsourcing contract. These employer costs are statutory or contractual, so please confirm this reading (or give another) before it is built.

**Still needed to start phase 4: H8 and H12** (yours or your tax adviser's) and the H19 confirmation. Open for later: H7, H14, and where a budget would come from.

## 4. What I will not do without your answers

- Choose a salary structure split (H8) or a PAYE method (H12).
- Pay anyone by the hour: until phase 4 is built and merged, hourly time entries and rates are records only, and every employee is paid exactly as before.

## 5. Suggested order once H8, H12 and H19 to H22 are answered

1. Plan confirmed (this note, with your answers).
2. The pure earnings step and the engine's optional input, tests first, no migration (golden datasets unchanged).
3. The migration for the stored hourly lines, and the pay run assembling the inputs and raising the findings.
4. The payslip and the minimum-pay warning.
5. The performance test (3,000 hourly people) and the mixed-company test in CI.
