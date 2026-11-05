# HR module: gap analysis against the review

Written 2026-11-05. The founder asked me to consider an external review of the HR module (eight functions: recruitment, employee administration, performance management, employee relations and welfare, disciplinary management, compensation and benefits, learning and development, career and succession) and to "review the existing architecture against these recommendations and identify what needs to be added, restructured or enhanced". **This is an analysis and a proposal only. Nothing beyond the menu regrouping in the navigation pull request is built, and each new workflow below needs the founder's decision and "go".** Everything stated as existing was checked in the code (models, services, pages) on 2026-11-05.

## 1. The short answer

- **Much of the review already exists, but is listed under broad headings.** The application already has recruitment through to hiring, probation outcomes, appraisals with weighted criteria and recommendations, a case system that covers grievances and misconduct with hearings, appeals and sanctions, exits and end-of-service settlements, training compliance, leave, policies and data-protection records. The menu change (one HR entry, grouped by function) fixes the positioning problem for these.
- **What is genuinely missing** is job descriptions and KPIs, performance improvement plans (a structured one), continuous feedback, promotion and salary-review workflows, grades and bands, bonus and incentive management, training needs and a training calendar, welfare and engagement, surveys, recognition, and career and succession planning.
- **The single employee record is already the source of truth:** every HR record (appraisal, case, sanction, training, contract, leave, exit) points at the employee by id and is scoped to the company, so the review's central architectural point holds today.

## 2. Function by function

| Review function | What exists today (checked) | Gap | Class |
| --- | --- | --- | --- |
| **1. Recruitment & talent acquisition** | Job requisitions, candidates and pipeline, interviews, pre-employment checks, job offers, conversion of a candidate to an employee | Applicant-tracking extras (assessments scoring, offer templates) are light | **Exists; position only** |
| **2. Employee administration** | Employee records and documents (references only, not files), employment contracts with **probation months, end date, outcome (pending, confirmed, extended, failed) and number of extensions**, onboarding tracker, exits and clearance, end-of-service settlements, letters, status management, reminders before probation and contract ends | **Promotion and demotion, grades, transfers as an HR action** (today a "transfer" is a deployment movement only); confirmation is a decision on the contract, not yet linked to an appraisal | **Partly exists; promotions missing** |
| **3. Performance management** | Appraisal cycles (annual, probation, ad hoc), weighted criteria set in Settings, self-assessment, reviewer rating, submit, return, approve, acknowledge, results report, and a **recommendation on approval (confirm employment, increment, promotion, training, performance plan)** | **Job descriptions, KPIs and targets, continuous feedback, a structured performance improvement plan (PIP), performance analytics.** The recommendations are recorded but start no workflow (correct: a score must not trigger a raise automatically) | **Partly exists; four pieces missing** |
| **4. Employee relations & welfare** | A case system: grievance, harassment, whistleblowing, counselling, mediation, other; severity, assignment, deadlines, notes, resolution and outcome; employees can raise and follow their own grievance (self-service) | **Welfare programmes, wellbeing, engagement, recognition, surveys and feedback** | **Cases exist; welfare missing** |
| **5. Disciplinary management** | The same case system also handles **misconduct** with an investigation and hearing stage, evidence, decision and **appeal** notes, and **sanctions issued from a case** (query, verbal warning, written warning, suspension, termination recommendation, commendation), with approval | **No separate Disciplinary area or permission**: misconduct shares the page, list and access with grievances. No distinct "employee response to a query" step. | **Exists; not separated** |
| **6. Compensation & benefits** | Salary structures and components, contract rate cards, employee salary overrides, personal pay rates (**proposed by HR and approved by a payroll manager, built 2026-11-05**), approved other earnings (bonuses, allowances), staff loans | **Grades and salary bands, a compensation policy, salary reviews and increments as a workflow, bonus and incentive schemes, benchmarking.** See section 4: the review itself advises treating the compensation framework as a separate engagement | **Pay mechanics exist; framework missing** |
| **7. Learning & development** | Training requirements (what each role must hold), employee training and certificate records, a compliance view with expiry alerts | **Training needs assessment, a training calendar and programmes, attendance, skills-gap analysis, effectiveness evaluation, learning paths** | **Compliance exists; development missing** |
| **8. Career & succession** | None | Career progression, development plans, succession planning, talent identification, internal mobility | **Missing** |

**Cross-cutting items in the review:** self-service for employees exists (payslips, leave, contacts, details, policies, appraisals, grievances); a manager-level self-service is partial (supervisors approve leave and record the work register); approvals exist for pay-rate proposals, detail changes, leave, sanctions, appraisals and loans; reminders and an HR digest exist; the audit trail exists; HR analytics are partial (attrition, headcount, training compliance, appraisal results).

## 3. What the navigation pull request now does

HR is one menu entry with these groups, using only pages that exist: **Recruitment; Employee administration** (onboarding, employment contracts and probation, letters, exits and clearance, settlements, attrition); **Performance management** (appraisals, appraisal criteria); **Employee relations** (cases); **Learning & development** (training compliance, training requirements); Leave; Privacy & records; HR setup. The missing functions get their own group the day a page for them exists.

## 4. Decisions I need from the founder

1. **Employee relations and discipline: split them?** I agree with the review in principle. The cheapest honest split keeps the one case engine (it already has the investigation, hearing, appeal and sanction steps) and gives **Disciplinary** its own page, list and permission (cases of type misconduct, with the sanctions queue), leaving **Employee relations** to grievances, harassment, whistleblowing, counselling and mediation. A full separate data model is not needed. Do you want this split, and may a person who handles grievances be a different person from the one who handles discipline (two permissions)?
2. **Performance management build order.** My recommendation: (a) **job descriptions and KPIs with weights and targets** feeding the appraisal; (b) a **structured PIP workflow** (reason, gaps, targets, support, review milestones, manager assessment, outcome); (c) **continuous feedback**; (d) a **probation review that ends in a confirmation decision** linked to the contract (confirm, extend, fail), with the existing reminders escalating before the end date; (e) analytics. Do you agree with the order, and with PIP being its own workflow?
3. **Promotion, salary review and increments.** These change pay, so each needs your rules and, for pay, a second-person approval like the pay-rate proposals. I recommend a **promotion and salary-review workflow** that takes an appraisal recommendation as an input, checks eligibility and budget, and ends in an approved change (grade, pay rate proposal) rather than changing anything automatically. Which approvers, and is there a budget check?
4. **Compensation framework.** The review advises treating the compensation framework you built for an organisation as separate professional work rather than software scope. **That is your call.** What I can build without it: grades and bands as data, and the salary-review workflow in decision 3.
5. **Learning & development, welfare and engagement, career and succession.** Which of these do your clients ask for first? I suggest L&D (training needs and a calendar) next because training records already exist, then welfare and recognition, then career and succession.

## 5. Order I propose (each its own pull request, tests first; any that touches pay or a migration waits for your "go")

1. **Menu regrouping** (in the navigation pull request now).
2. **Disciplinary separated from Employee relations** (screens and one permission; no new data model).
3. **Performance management: job descriptions and KPIs, then PIP, then continuous feedback, then the probation review.**
4. **Promotion and salary-review workflow** (needs your rules; touches pay).
5. **Learning & development**, then **welfare and recognition**, then **career and succession**.
6. **HR analytics** across the above.

## 6. What this does not change

No data, permission, payroll or statutory change comes from this document. The only code change it accompanies is the menu grouping, which keeps every page's address, permission and module check.
