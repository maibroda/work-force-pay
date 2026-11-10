# Decisions to confirm and what a lawyer should review

Written 2026-11-10. Every HR feature built so far was built on **my recommended answers**, because the questions in each plan were not answered. Nothing below is wrong yet; it is a list of choices I made for you, so you can confirm or change them while they are cheap to change. The full numbered question list of each feature is in its plan file (`docs/plans/<feature>-plan.md`); this page keeps only the decisions that carry policy or legal weight.

**How to answer:** reply per feature, for example "welfare: agree except 6; career: change 5 to ...". Anything you do not mention stays as built.

## A. Decisions to confirm (what I built, and what changes if you say otherwise)

| Feature | The choice I made | If you change it |
| --- | --- | --- |
| **Feedback** (#166) | The employee always sees feedback about them; no private notes. Only the reporting manager and HR give it; the auditor does not read it. | Private manager notes would need a separate store and a rule on what an employee may ask to see. |
| **Probation** (#168) | The person who signed off the probation appraisal cannot also decide the probation; a decision against the appraisal's recommendation needs a fuller reason; the employee hears only once HR marks them told; a failed probation starts no exit automatically. | The separation rule is a small change; "automatic exit" is a legal question (see B). |
| **Improvement plans** (#164) | Defaults: 60-day plan, 90 days at most, one extension of 30 days, a review every 14 days. | Settings in HR policy; no code change. **Please have these checked (B).** |
| **Learning and development 1** (#170) | Attending creates the certificate record; only HR adds training needs; no costs; seats are a hard limit with no waiting list. | Costs need your money rules; a waiting list is a small add. |
| **Welfare** (#172) | Welfare support is a confidential case read **only by the HR administrator** (your decision); the summary hides groups under five; no money. | Already decided. A company with no HR administrator cannot read a welfare case. |
| **Recognition** (#172) | A second person approves every award; the employee hears only of approved awards; the board shows only an award the recipient agreed to; milestones are a prompt, never an automatic award. | "Too heavy for small awards" can be a per-award setting. |
| **Career and succession** (#174) | A role is an employee category (no job title or grade yet); career paths warn and never block; a manager proposes for direct reports and HR decides; succession is read **only by the HR administrator**, is not shown to employees and is **not in the employee's data copy**. | Putting succession in the data copy is a one-line change but a legal question (B). |
| **Learning and development 2** (#178) | A manager (not the employee) requests training; the participant's evaluation is **confidential, not anonymous**; the employee reads the manager's evaluation; the manager is asked 60 days after; results show only from five answers. | Fully anonymous evaluation means one person could answer twice. |
| **Skills and learning paths** (plan #179, building next) | Four fixed levels; managers assess direct reports; no self-assessment yet; the employee reads the whole history; a skill level is never read beside an appraisal; the auditor reads assessments. | Self-assessment and a company-defined scale are possible later additions. |
| **Surveys** (plan #180, building after) | Five answers minimum; a group of fewer than ten cannot be surveyed alone; HR sees only counts of who took part; breakdown by role and department only; online only for employees with a login; HR administrator alone runs surveys; no manager team results; raw answers deleted after 24 months; a closed survey is never reopened. | The guard question (no login) is the real design test; the rest are tunable. |

**Three questions only you can answer**
1. **Site guards without a login:** should surveys wait until they have one, or do you accept online-only for now and a paper-batch step later if participation is low?
2. **A company with no HR administrator:** welfare and succession are readable only by that role. Do you want a rule that every company keeps at least one, or an alternative holder?
3. **Retention periods** for every record type below. I used "the existing employee retention setting" or the plan's suggestion; you choose the real numbers with your lawyer.

## B. What a lawyer should review (not something I can decide)

1. **Welfare cases** (health, bereavement, family, hardship): this is sensitive personal data. Review the wording an employee sees when raising one, whether explicit consent is needed, who may read it, and how long it may be kept.
2. **Improvement plans and probation:** whether 60/90 days, one extension and 14-day reviews are reasonable for your contracts; what must happen before a notice after a failed probation or plan (my build starts no exit); the wording of any letter.
3. **What an employee may ask to see (data subject access):** the build puts approved awards, approved or applied promotions, their own evaluation answers, the manager's evaluation of them, accepted training requests, and (from the next build) their skill assessments in their data copy. It deliberately leaves **succession out**, and **survey answers cannot be in it** (they carry no person). Is that right under the Nigerian rules?
4. **Surveys:** the anonymity promise wording; whether anonymous survey data is personal data; retention; how a paper-batch step must work; whether sensitive questions need a different basis.
5. **Retention and erasure together:** what the company must keep (labour and tax records) against what a person can ask to have erased. The build removes free text on erasure and keeps the shape (ids, dates, statuses, ratings) and the audit log. Is the shape enough to keep?
6. **Naming people publicly:** the recognition board shows a name only with the recipient's agreement; confirm the consent wording.
7. **Manager judgements about a person** (feedback, evaluation, skills): whether a numeric level or rating changes what the company owes the employee in transparency or fairness.
8. **Hosting and keys** (not HR-specific): the document encryption key must be set on the host with a separate backup, and the data is intended to be hosted in Lagos; confirm what the data protection rules ask for on hosting and processor agreements.

**What to give the lawyer:** the explain-back notes `docs/plans/welfare-recognition-explain-back.md`, `career-succession-explain-back.md`, `learning-development-step2-explain-back.md`, `continuous-feedback-explain-back.md`, `performance-improvement-plan-explain-back.md` and `probation-review-explain-back.md`, plus the two new plans (skills, surveys). Each states plainly what the code does and what it does not.

## C. What I will not do without you

Write legal advice into the screens; add money to welfare, recognition or training; make any survey result or skill level feed pay, an appraisal or a decision about a person; or use real personal data in tests.
