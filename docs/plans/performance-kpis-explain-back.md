# Explain-back note: job descriptions and KPIs feeding the appraisal

Branch `performance-kpis`. One migration, `20261125090000_performance_kpis` (three new tables, three enums, five additive columns). This changes **how an appraisal score is worked out**, so it needs your review. Built on your decisions (the plan `docs/plans/performance-management-phase1.md`; you gave the go on 2026-11-06 with my four recommendations adopted).

## The rule, in plain words

1. **A job description per employee category**, with KPIs. HR drafts it; **a second person makes it active** (never the drafter). An active version is never edited: a change is a new draft that starts as a copy.
2. **A review cycle has a KPI share** (a whole percentage, 0 to 100; **0 is the default and scores exactly as before**).
3. When a cycle with a share above 0 is launched, **each appraisal copies the employee's category's active KPIs** (name, unit, direction, target, weight). Later edits never change a review under way.
4. The reviewer enters the **actual result** for each KPI. When the review is submitted, for each KPI: **achievement = actual / target** (for a lower-is-better KPI, target / actual; an actual of zero counts as the top), in basis points (10,000 = 100%), rounded half up and capped at ten times the target. The **company's bands** turn the achievement into a score from 1 to 5.
5. **KPI score** = the weighted average of the KPI scores (weights relative), to two decimals, rounded half up.
6. **Overall score** = criteria score x (100 - share)% + KPI score x share%, rounded half up to the hundredth. With a share of 0 it is the criteria score untouched.

All of this is **whole-number arithmetic** (the figures are read as exact decimals with up to four places; nothing is floating point).

## A worked example

A guard's job description has two KPIs. "Shifts covered without a late arrival": target 95%, weight 60, actual 90%, so achievement 94.74% (9,474 basis points), score 3 (the 75% to under 100% band). "Incident reports filed the same day": target 100%, weight 40, actual 100%, achievement 100%, score 4 (the 100% to under 120% band). **KPI score** = (3 x 60 + 4 x 40) / 100 = **3.40**. The reviewer's criteria average is **4.00**. With a **40% KPI share**: overall = 4.00 x 60% + 3.40 x 40% = **3.76**, "Exceeds expectations".

## Where each rule comes from

- **The KPI share** is chosen per cycle by whoever launches it (appraisal.manage). **The bands** are HR policy data that HR-configure users can change on the Job descriptions page; the defaults (below 50 = 1; 50 to under 75 = 2; 75 to under 100 = 3; 100 to under 120 = 4; 120 and over = 5) are the ones I proposed and you accepted on 2026-11-06. **Please check them: they affect people's ratings.**
- Nothing about pay changes. An appraisal recommendation (increment, promotion) stays a recommendation only.

## What could go wrong, and what proves it does not

| Risk | Test |
| --- | --- |
| Existing appraisals change | The 76 existing appraisal, probation, digest and HR tests pass unchanged; "with a 0% share the overall score is exactly the criteria score" |
| Wrong arithmetic (rounding, floating point, lower-is-better, zero) | `performance.test.ts`: the worked example, band edges, half-up rounding, 0.3 / 0.1, an actual of zero, the cap |
| One person drafts and activates | "a second person makes it active, never the one who drafted it" |
| A live review changes under the reviewer | "a later change to the job description does not change a review under way" |
| The employee sees the reviewer's KPI results early | "the employee sees no KPI result or score until the appraisal is signed off" |
| Another company sees or changes these | "another company sees nothing", including a KPI id from another company |
| Someone without the right permission drafts, activates or sets the bands | role checks in `performance-kpis.test.ts` (appraisal.manage, hr.approve, hr.configure) |
| The migration loses data | round trip on a copy of the seeded database |

## What I did not do or test

- **Not built:** the PIP workflow, continuous feedback, the probation review that ends in a confirmation decision, analytics, and per-employee or per-site targets (a guard at a high-risk site and one at a quiet site share a target for now).
- **Not clicked in a browser:** I loaded the new pages over HTTP as the HR administrator, finance, the auditor and the employee role and checked what each sees (and all 12 roles for open or forbidden), but I did not click through the create, add-KPI and bands forms in a browser; those are covered by the service tests. The sign-in in the browser pane was too slow to complete on this machine.
- **A cycle that gives KPIs a share leaves out** staff whose category has no active KPIs. They are listed with the reason when the cycle is launched, but they will not get an appraisal in that cycle: launch a separate cycle with a 0% share for them.
- **Probation appraisals** (started from a contract) do not use KPIs in this phase.
