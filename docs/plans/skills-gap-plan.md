# Skills, skill gaps and learning paths: a proposal

Written 2026-11-10. **A proposal only: nothing is built and no migration is written until the founder answers the questions in section 6 and says "go".** It follows learning and development step 2 (#178) and the career paths of career and succession step 1 (#174), and it is the "skills-gap analysis and learning paths together" item that step 2 named. **It involves no money.**

## 1. What exists today (checked in the code on 2026-11-10)

- **A role is an employee category** (Guard, Supervisor, and so on). There is no job title or grade. Each category can have a versioned **job description with KPIs** and the **appraisal criteria** are company-wide ratings. **None of these say which skills a role needs or how well a person has them.**
- **Certificates and required courses** (`TrainingRequirement`, `EmployeeTraining`) say whether a person holds a mandatory certificate; compliance is shown to HR and, since step 2, to the employee ("What you are required to hold").
- **Training needs, programmes, sessions, attendance and evaluation** (L&D steps 1 and 2) plan and record training. A need is added by a person, never automatically.
- **Career paths** (career and succession step 1): the company states which role can lead to which, the months asked and a course asked; the employee sees their own progress on **My career**. A path asks for **a course**, never **a skill**.
- **Not there:** a list of the skills the company cares about, what level each role needs, how well each person has each skill, the gap between the two, and a way to show a person what to build to reach a role they are aiming for.

## 2. What this adds

1. **A skill library** (Settings > **Skills**): the company's own skills (for example "First aid response", "Report writing", "Shift supervision", "Handling an incident"), each with a short description and, optionally, **the courses that build it** (by course name, matched the way compliance matches them). The company starts with none.
2. **What each role needs** (Settings > Skills, per role): for a role, the skills it needs and the **level** required (1 to 4, below). A role can need several skills; a skill can be needed by several roles.
3. **Assessing a person.** A manager assesses **their own direct reports** (HR anyone, nobody themselves) at a level for a skill, on a date, with an optional one-line comment (up to 300 characters). **An assessment is a record, never edited**: a new assessment replaces it as the current level and the earlier ones stay as history. The levels are fixed: **1 Aware, 2 Basic, 3 Proficient, 4 Expert** (question 2).
4. **The gap view.** For a person: each skill their role needs, the level required, their current level (or **Not assessed**) and the difference. For HR: per role, per skill, how many people are at or above the level, below it, or not assessed, and the named list. For a manager: their own direct reports. **A gap changes nothing by itself**: no need, enrolment, pay, status or appraisal.
5. **From a gap to a need, by a person.** HR can add a **training need** for a gap, offering the courses linked to the skill (the existing add-a-need form, with a fixed note "Skill gap: First aid response"). **Never automatic.**
6. **Learning paths** (no new table: derived). For each career path the company set (role to role), **My career** shows the employee the skills of the target role where they are below the level, with the courses that build each and their own progress; the manager and HR see the same for a direct report. It is a guide to what to build, not a promise.
7. **The employee reads everything.** What is recorded about a person's skills is shown to them on **My skills** (My HR), with who assessed and when, as they read feedback: there are no private notes about a person's performance.

## 3. The rules in plain terms (with a worked example)

- **Who assesses whom** is the rule already used for feedback, recognition, promotions and evaluation, reused rather than rewritten: a manager about a direct report, HR about anyone, nobody about themselves. Anyone else is "Employee not found". The employee, the auditor and finance cannot assess.
- **The library and the requirements** are set by someone who configures HR (`hr.configure`); everyone who reads HR records (`hr.view`, including the auditor) reads them and the gap view.
- **An assessment is append-only.** The current level of a skill for a person is the latest assessment. A correction is a new assessment; the history is kept and shown to HR and the employee.
- **Not assessed is not a gap.** A skill nobody has assessed shows as "Not assessed" and is counted separately, so a missing record is never read as a weakness.
- **A skill level changes nothing about the person**: no pay, status, deployment, appraisal score or certificate. (Question 5 asks whether an assessment may ever be read beside an appraisal; the recommendation is no.)
- **Personal data:** assessments (with their comments) are in the **employee's copy of their data** and **the comments are removed on erasure**, the levels, skills and dates staying. Audit entries carry ids, the skill and the level, never a comment.
- **Worked example:** the company sets the skill "Shift supervision" (built by the course "Supervisory skills") and says the **Site Supervisor** role needs it at level 3. Tunde, a guard aiming for that role (a career path Guard to Site Supervisor exists), is assessed by his manager Sade at **level 2, Basic**, with the comment "Leads the night handover well". **My career** now shows Tunde: "To reach Site Supervisor, build Shift supervision: you are at 2, the role needs 3; the course Supervisory skills builds it." HR sees that 3 of the 8 guards on the path are below level 3 and adds a training need for Tunde from that gap; nothing else happens until HR plans him onto a session. Six months later Sade assesses him at 3; his gap closes and the earlier assessment stays in the history.

## 4. Files, migration, permissions and tests (once approved)

- **Migration (one, additive, reversible, round-tripped on a copy of the seeded database):** three tables (`Skill`, `RoleSkill`, `SkillAssessment`). No existing table or enum changes; a skill-gap training need uses the existing "other" source with a fixed note.
- **Permissions:** one new, `skills.assess` (HR administrator, supervisor and operations manager; managers limited to their direct reports, as `recognition.nominate` and `career.propose`). Configuring uses `hr.configure`; reading uses `hr.view`.
- **Pure functions first** (`src/lib/skills.ts`): the levels and their labels, the gap of a requirement against a current level, the current level from a history, the counts at, above, below and not assessed, and the learning-path list for a career path. **Unit tests first.**
- **Services and screens:** Settings > **Skills** (library and role requirements); HR > Performance management > **Skills and gaps** (per role, per person); **My team's skills** (managers assess and see their reports); **My skills** (My HR); the learning path on **My career**; the data copy and erasure; navigation and entry modules; release notes, data dictionary, explain-back note. **Every new employee-facing query selects only the fields it returns.**
- **Tests (integration, written first):** a manager assesses only a direct report, never themselves; the employee, the auditor and finance cannot; a level outside 1 to 4 and an over-long comment are refused; the current level is the latest and the history is kept; not assessed is counted apart from a gap; the gap view agrees between the person, their manager and HR; the learning path lists exactly the skills of the target role the person is below; adding a need from a gap makes exactly one need and nothing else; an assessment changes no pay, status, certificate, appraisal or career proposal; the employee reads their own and no one else's; tenant isolation; audit by ids only; erasure removes the comments and keeps the shape.

## 5. Not in this step

Skills for **hiring or promotion decisions** (a proposal never needs a skill level; the warnings stay as they are), **scoring or ranking** people by skills, a **nine-box** or any potential rating, **automatic suggestions** of people for a role, **360-degree or peer assessment**, **skill levels feeding pay or grades**, an **external skills taxonomy** or import, **learning content** (courses stay in training), **costs and budgets**, and notifications.

## 6. Questions for the founder (my recommended answer first)

1. **Is this the right scope: library, role requirements, assessment, gap view and a derived learning path?** **Recommended: yes**, with costs and surveys separate.
2. **Four fixed levels (Aware, Basic, Proficient, Expert)?** **Recommended: yes**; a company-defined scale is harder to compare and can follow later.
3. **Who assesses: a manager for direct reports, HR for anyone?** **Recommended: yes.**
4. **May an employee add a self-assessment**, shown beside the manager's and never replacing it? **Recommended: not in this step**; the employee reads the manager's and can raise a disagreement with the manager or HR.
5. **May a skill level ever be read beside an appraisal?** **Recommended: no.** An appraisal already reads feedback and certificates; a second assessed number invites double counting.
6. **Should a career-path warning also mention a skill gap** (alongside "course missing")? **Recommended: not yet**; the learning path shows the gap to the employee, and the promotion proposal stays as built.
7. **Does the employee read the full history of their assessments?** **Recommended: yes**, with who assessed and when.
8. **Does the auditor read assessments?** **Recommended: yes**, as for other HR records (`hr.view`).
9. **Are skills linked to courses by course name**, as certificates are? **Recommended: yes**, so there is one way to match a course.
10. **Reassessment:** should HR see assessments older than a number of days (a company setting, default 365) so levels do not go stale? **Recommended: yes**, as a list on the Skills and gaps page, never a block and never a score.

**Risks:** an assessment is a manager's judgement, and a numeric level can feel like a rating of the person. The safeguards are that the employee reads everything, an assessment is never edited, it changes nothing automatically, and it is not read beside pay or an appraisal. A lawyer should review the wording an employee sees and how long assessments are kept.
