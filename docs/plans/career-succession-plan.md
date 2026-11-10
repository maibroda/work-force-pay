# Career and succession, step 1: promotion proposals, career paths and succession cover

Written 2026-11-10. **A proposal only: nothing is built and no migration is written until the founder answers the questions in section 6 and says "go".** It is the last item of the founder's recorded HR order ("Learning & development, then welfare and recognition, then career and succession", `docs/plans/founder-decisions-2026-11-05.md`); learning and development step 1 (#170) and welfare and recognition step 1 (#172) are merged.

## 1. What exists today (checked in the code on 2026-11-10)

- **A person's role is their employee category** (`Employee.categoryId`: Guard, Supervisor, Cleaner and so on). There is **no job title, grade or position** on the employee record, and no history of category changes except the audit log. A promotion today is: HR changes the category and the pay.
- **Pay changes already have a maker and checker.** A new gross for someone paid a personal amount is **proposed by HR and approved by a payroll manager** (`PayRateProposal`); back pay for a late promotion is an **arrears** line of type "Retrospective promotion". **Nothing in this plan touches either.**
- **The appraisal can recommend "Promotion"** (`AppraisalRecommendation`); it starts nothing, by design: a score must not trigger a process on its own. The probation decision record also marks a decision that went against such a recommendation.
- **Job descriptions and KPIs** exist per category (versioned), and the **promotion letter** is a document type.
- **Not there:** any record of **a promotion decision** (who proposed it, why, who approved it, when it took effect); any statement of **which roles lead to which** (a career path); any notion of **who covers a critical role** if its holder leaves.

## 2. What step 1 adds

1. **Career paths.** The company states, in Settings, which category **can lead to** which other, and optionally the **minimum months of service in the current category** and a **required course** (an existing training requirement name). It is data the company owns, with nothing provided. It is a guide for the proposal screen, never a rule that blocks a promotion HR has reason for (a warning, with the reason in the record).
2. **Promotion (role change) proposals.** HR, or a manager for **their own direct reports**, proposes that an employee **moves to another category**, with a few plain sentences of reasons and an intended date. The page shows the **evidence**, read-only: time in the current category, the latest **signed-off appraisal's score and recommendation**, the required course status, and **whether an improvement plan is open** (a yes or no, never its contents). **Someone other than the proposer decides** (`hr.approve`); a decline needs a reason. **Approval changes nothing by itself**: it records the decision. HR then **applies** it, using the existing employee and pay screens, and marks the proposal **Applied** (the system checks the employee's category now equals the target and records the date). The pay itself goes through the existing pay-rate proposal and its own approval; back pay through arrears. An approved proposal can be **withdrawn** with a reason while not yet applied.
3. **Succession cover.** HR names the **critical roles** (a category, or a category at one client or site) and, for each, up to **five successors** with a **readiness** (ready now, ready in 1 to 2 years, ready in 3 or more) and a one-line reason. The page shows each critical role's holders, how many are **due to leave soon** (retirement age is not assumed: only an exit already raised or a contract ending), and the roles with **no ready successor**. It is a list kept by a person; **nothing is suggested or scored automatically**.
4. **The employee's own page** (**My career**, under My HR): their current role, the paths from it that the company has set (the roles it can lead to, the service and course asked for, and **their own** progress against each), and their own **approved or applied** promotion. They never see a proposal under consideration, a declined one, or **any succession list** (whether they are on it or not).
5. **The HR digest** gains one line: approved promotions not yet applied after a number of days (a company setting, default 14).

## 3. The rules in plain terms (with a worked example)

- **A promotion is a record of a decision, not a change.** No category, pay, payslip, allowance, deployment or payroll figure changes when a proposal is approved. Applying it is HR's act on the existing screens (and pay on the existing pay approval). **This plan adds no way to change pay or the category.**
- **Who proposes whom:** HR about anyone; a manager only about **their own direct reports** (anyone else is "not found"); **nobody about themselves**. A person with an **open improvement plan or an open disciplinary case** can still be proposed, but the page says so and the decider must give a reason to approve (a warning, not a block: the company decides).
- **Maker and checker:** the proposer cannot decide. Applying is HR's act on screens that keep their own approvals (question 4).
- **Succession is the most sensitive of these lists.** It is read and edited only by those holding a new permission, **`succession.manage`**, which, as with welfare, is held by the **HR administrator** (question 5). The employee never sees it, a manager never sees it, the auditor does not (question 6). Audit entries for it carry ids and the readiness level, never the reason text.
- **Personal text** (proposal reasons, a decline reason, a successor's reason) goes in the employee's **copy of their data** (the approved and applied proposal and their own career page, but **never succession**, which is HR's planning record, see question 7) and is **removed on erasure**, the shape staying.
- **Worked example:** the company sets "Guard to Supervisor: at least 24 months in the role; course: Supervisory skills". Ngozi (HR) opens the proposal for Tunde, a guard of 31 months, last appraisal 4.2 with "Promotion", the course valid, no plan open; she writes two sentences and an intended date of 1 January. The payroll manager (not Ngozi) approves. On 1 January Ngozi changes Tunde's category to Supervisor, proposes his new pay through the pay-rate proposal (approved by the payroll manager as today), and marks the promotion Applied; the system confirms his category is Supervisor. Tunde sees "Promoted to Supervisor, 1 Jan 2027" on My career. Had the proposal been declined, he would never have known.

## 4. Files, migration, permissions and tests (once approved)

- **Migration (one, additive, reversible, round-tripped on a seeded copy):** two enums (proposal status and readiness), four tables (`CareerPath`, `PromotionProposal`, `SuccessionRole`, `SuccessionCandidate`), one HR policy column (days before an unapplied promotion is flagged). No existing table is changed beyond the policy.
- **New permissions:** `career.propose` (HR and managers, managers limited to their direct reports, as `recognition.nominate`) and `succession.manage` (HR administrator only). Deciding uses `hr.approve`, paths use `hr.configure`; reading proposals uses `hr.view`.
- **Code:** pure rules in `src/lib/career.ts` (eligibility warnings, who may propose whom, status moves), services in `src/server/services/career.ts` and `succession.ts`, actions, pages (HR: **Promotions**, **Succession**; Settings: **Career paths**; Me: **My career**, **My team's promotions**), nav, entitlement entries, the data export and erasure, release notes, data dictionary, explain-back note.
- **Tests first:** the eligibility and status rules (unit); proposing (own reports only, never oneself), the maker and checker rule, apply-only-when-the-category-matches, nothing changing on approval (the employee's category, pay rates and payroll figures are identical before and after), the employee seeing only their own applied promotion, **succession invisible to every role but `succession.manage`** (list, count, timeline, digest, export), tenant isolation, audit by ids only, and erasure.

## 5. Not in this step

Skills matrices and competency frameworks; a nine-box or any automatic scoring of potential; automatic suggestions of successors or promotions; changing pay or category from the proposal; salary bands and grades; internal job posting and applications; mentoring and development plans (training needs already exist); lateral transfers between clients or sites (deployment already exists); succession for the whole organisation chart above the category level.

## 6. Questions for the founder (my recommended answer first)

1. **Is a category the right unit of "role"** (Guard, Supervisor), as there is no job title or grade? **Recommended: yes**, a promotion is a move to another category; titles and grades are a later step.
2. **Career paths as guidance, not a rule?** **Recommended: yes**: a warning with a reason, never a block.
3. **May a manager propose for their own direct reports**, with HR deciding? **Recommended: yes.**
4. **Must the person who decides differ from the one who applies it?** **Recommended: no**: the proposer cannot decide, and applying changes a category and pay only through screens that already have their own approvals.
5. **Who holds `succession.manage`?** **Recommended: the HR administrator only**, as you decided for welfare.
6. **May the auditor read the succession list?** **Recommended: no.** (They read proposals under `hr.view`.)
7. **Is the succession list in the employee's copy of their data?** **Recommended: no**: it is HR's planning record about a future that has not happened (a lawyer should confirm: it may be personal data a person can ask for under data-protection law).
8. **Should an open improvement plan or disciplinary case block a proposal?** **Recommended: warn and require a reason**, never block.
9. **Is five successors per critical role and three readiness levels enough?** **Recommended: yes.**
10. **Should this step also cover moving a person to a different client or site** (a transfer)? **Recommended: no**, deployments already do that.

**Risks:** succession is sensitive and subjective; the guard against misuse is who can read it, not scoring it. A lawyer should review the wording an employee sees about a decision that did not go their way (they see nothing) and how long proposals and succession entries are kept.
