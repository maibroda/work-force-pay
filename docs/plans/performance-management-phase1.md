# Performance management, phase 1: job descriptions and KPIs that feed the appraisal

Written 2026-11-06. **A proposal only: nothing is built and no migration is written until the founder answers the four questions in section 5 and says "go".** It is item 4 in the build order of `docs/plans/founder-decisions-2026-11-05.md`, step (a) of the performance-management order the founder adopted: job descriptions and KPIs with weights and targets feeding the appraisal; then a structured performance improvement plan (PIP); then continuous feedback; then a probation review that ends in a confirmation decision; then analytics.

## 1. What exists today (checked in the code on 2026-11-06)

- **Appraisals** (`src/server/services/appraisals.ts`, models `AppraisalCriterion`, `AppraisalCycle`, `Appraisal`, `AppraisalRating`): a company-wide list of **criteria with weights** (edited in Settings); a **cycle** (annual, probation and so on) snapshots the active criteria when it is launched; each appraisal runs self-assessment, then the reviewer's ratings (1 to 5), then **sign-off by someone other than the reviewer**, then the employee's acknowledgement or dispute. The overall score is the **weighted average of the ratings**, fixed at submission, with a band and a **recommendation** (confirm employment, increment, promotion, training, **performance plan**, none).
- **Probation appraisal** is started from the employment contract (`startProbationAppraisal`).
- **Not there:** a **job description** for a role, **KPIs** (measurable targets with a unit and an actual result), and any way for results to feed the score. All criteria are company-wide, the same for a guard, a supervisor and an office clerk.

## 2. What phase 1 adds

1. **Job descriptions**, one per **employee category** (guard, supervisor, driver, cleaner, office staff and so on): title, purpose, responsibilities, versioned. A new version is drafted by HR and **made active by a second person** (`hr.approve`), because it will drive how people are rated. History is kept; an appraisal shows the job description that was active when its cycle was launched.
2. **KPIs under a job description**: name, what it measures, **unit** (percentage, count, naira, rating), **direction** (higher is better, or lower is better, for example "incidents reported late"), **target**, **weight**. Targets are the same for everyone in the category for now (see question 3).
3. **KPI results on the appraisal**: when a cycle is launched, each appraisal **snapshots** its category's KPIs (so later edits never change a review under way, exactly as criteria work today). The reviewer enters the **actual** for each KPI and a comment; the system works out the achievement and a **KPI score from 1 to 5**.
4. **One overall score.** The cycle sets a **KPI share** (for example 40%): overall = (criteria average x (100 - share) / 100) + (KPI score x share / 100). **A cycle with a KPI share of 0% (the default) behaves exactly as appraisals do today**, so no existing appraisal or test changes.
5. **Settings as data, not code:** the **achievement-to-score bands** (see question 2) live in the HR policy settings, with who changed them and when, not in the code.

## 3. How a KPI becomes a score (all whole-number arithmetic, no floating point)

- **Achievement** (in basis points, 10,000 = 100%): higher is better = actual / target; lower is better = target / actual (an actual of zero counts as full marks), both rounded half up. Capped at the top band.
- **Score 1 to 5** from the bands. My proposed defaults, **for the founder to confirm or replace**: below 50% = 1; 50% to under 75% = 2; 75% to under 100% = 3; 100% to under 120% = 4; 120% and above = 5.
- **KPI score for the appraisal** = weighted average of the KPI scores (weights as set), rounded half up to two decimals like the criteria score today.
- **Worked example:** a guard's KPIs: "shifts covered without a late arrival" target 95%, weight 60, actual 90% (achievement 94.7%, score 3); "incident reports filed on the same day" target 100%, weight 40, actual 100% (score 4). KPI score = (3 x 60 + 4 x 40) / 100 = 3.40. Criteria average 4.00. With a 40% KPI share: overall = 4.00 x 0.60 + 3.40 x 0.40 = **3.76**.

## 4. Files, migration, permissions and tests (once approved)

- **Migration (additive, reversible, round-tripped on a copy of the seeded database):** `JobDescription`, `Kpi`, `AppraisalKpi` tables; an enum for unit and direction; one column on `AppraisalCycle` (`kpiSharePct`, default 0); the score bands as a column on the HR policy. No existing column changes meaning; no data is rewritten.
- **Pure functions first** (`src/lib/performance.ts`): achievement, score from bands, KPI score, blended overall. **Unit tests first**, including the worked example above, a zero actual, lower-is-better, the band edges and "0% share changes nothing".
- **Services and screens:** job descriptions and KPIs under HR > Performance management; the KPI section on the appraisal page; "KPI share" when launching a cycle; the bands in the HR policy page. Each page declared in `entry-modules.ts` and in the navigation.
- **Permissions:** drafting uses `appraisal.manage`; making a job description active needs `hr.approve` by a person other than the drafter; entering actuals is the reviewer (as ratings are today).
- **Tests (integration):** another company cannot see or use them; the drafter cannot activate their own version; a launched cycle's snapshot does not change when a KPI is edited; with a 0% share the score equals today's score; the audit log records changes by ids and field names, never values.
- **Documents:** release notes, data dictionary (regenerated), an explain-back note for the scoring.

## 5. Questions for the founder (my recommendation in bold)

1. **KPI share:** a **per-cycle setting, default 0%**, so nothing changes until you choose to use KPIs (for example 40% to 50% when you do)? Or a fixed company-wide share?
2. **The five bands** in section 3: **accept them**, or give your own (they affect people's ratings, so please check them).
3. **Who sets KPI targets:** **per job description, the same target for everyone in the category**, with per-employee or per-site targets later if you need them? (A guard at a high-risk site and a guard at a quiet one then share a target.)
4. **Second-person approval** to make a job description or its KPIs active: **yes** (HR drafts, a second HR approver activates)?

## 6. What is not in phase 1

The PIP workflow, continuous feedback, the probation review ending in a confirmation decision, performance analytics, and any link from an appraisal to pay (promotion or increment stay as recommendations only; a pay change goes through the existing pay-rate proposal and approval).
