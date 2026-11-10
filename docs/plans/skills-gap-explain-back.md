# Explain-back note: skills, skill gaps and learning paths

Branch `skills-build`. One migration, `20261206090000_skills_and_gaps` (additive: three tables, one HR policy column, no enum). This touches **personal data** (a manager's judgement about a person) and **access control** (who may assess and read), so please read it. Built on your "go" of 2026-11-10 to the plan `docs/plans/skills-gap-plan.md` (#179). **You did not answer the plan's ten questions, so I used my recommended answers; they are listed under "Assumptions".** **No money is involved. Nothing in this step changes pay, status, a certificate, an appraisal or a promotion proposal.**

## The rules, step by step

1. **The library and the requirements** belong to the company and none are provided. Someone who configures HR (`hr.configure`) adds a skill (a name; no duplicate however typed), optionally lists the courses that build it, and sets the **level a role needs** from 1 to 4 (Basic, Developing, Proficient, Advanced: the founder's names and definitions of 2026-11-10, which replace the plan's Aware, Basic, Proficient, Expert). A skill can be switched off; assessments already made are kept.
2. **Who assesses whom** is the rule already used for feedback, recognition, promotions and evaluation, reused: a manager about **a direct report**, HR about anyone, **nobody about themselves**. For anyone a manager may not assess, the answer is only "Employee not found". The employee, the auditor and finance cannot assess. An employee who has left, or a switched-off skill, cannot be assessed.
3. **An assessment is append-only.** It records the level (1 to 4), an optional comment (up to 300 characters), who assessed and the day. The **current level is the latest** (by the day, then by when it was recorded); a correction is a new assessment and the earlier ones stay as history. Nothing is edited or deleted.
4. **Not assessed is not a gap.** A skill nobody has assessed shows as "Not assessed" and is counted apart from "Below".
5. **The gap view** shows the person, their manager (for their own reports) and HR the same answer: each skill the role needs, the level needed, the current level, and whether it is Met, Below (with how far) or Not assessed. For HR, per role and skill, the counts at or above, below and not assessed, with the named list of those below, and the **assessments older than the company's number of days** (default 365, 0 = never) as a prompt to refresh. A test checks that the person's page, the manager's page and HR's page agree.
6. **From a gap to a need.** HR (`hr.manage`) can add a training need for a person with a **real gap** (a level below what the role needs: never for "not assessed") for a course linked to the skill; it uses the existing add-a-need function with the existing "other" source and the fixed note "Skill gap: <skill>". It adds one need and nothing else (a test counts enrolments and certificates before and after). It is refused if the course is not linked to the skill, if there is no gap, or if the person already has an open need for the course.
7. **Learning paths are derived.** For each active career path set from the person's role, the page lists the skills of the **target role** that the person is below or has not been assessed on, never the ones they meet, with the courses that build each, and the course the path itself asks for. No new table. It is a guide, not a promise: a promotion is decided as before.
8. **What the employee reads (My skills):** what their role needs, where they stand and the **whole history** of each skill with who assessed and when. Never anything about anyone else (a test checks the exact fields).
9. **Personal data and audit.** The assessments, with their comments, are in the employee's copy of their data; on erasure the **comments are removed** and the skill, level, assessor and day stay. **Audit entries carry ids, the skill and the level, never a comment.** Every new query selects only the fields it returns.

## A worked example

The company sets the skill "Shift supervision" (built by the course "Supervisory skills") and says the **Site Supervisor** role needs it at **level 3**; a career path Guard to Site Supervisor exists. Sade assesses her report Tunde, a guard, at **level 2** with the comment "Leads the night handover well". On **My career** Tunde now reads: "To reach Site Supervisor: Shift supervision, you are at 2, the role needs 3. Courses that build it: Supervisory skills." On **My skills** he reads the assessment, the level, who made it and the date. HR sees 3 of 8 guards on the path are below level 3, opens Tunde on **Skills and gaps** and adds the need "Supervisory skills" from the gap; nothing else happens until HR plans him onto a session. Six months later Sade assesses him at 3; the gap closes and the earlier assessment stays in the history. At no point did his pay, status, appraisal or any promotion proposal change.

## What could go wrong, and what proves it does not

| Risk | Test |
| --- | --- |
| A manager assesses someone who does not report to them, or themselves | `skills.test.ts`: "Employee not found" / "yourself" |
| The employee, the auditor or finance assess | refused on every call |
| A level outside 1 to 4, an over-long comment, a switched-off skill or an employee who has left | each refused with its own message |
| An assessment is edited or overwritten | the append-only test: two assessments are two rows; the history keeps both; the current level is the latest |
| A missing assessment is read as a weakness | the gap tests: Not assessed is its own state and is counted apart |
| The person, the manager and HR see different answers | the agreement test compares all three |
| A learning path lists a skill the person already meets, or leaves out an unassessed one | the path tests: only Below and Not assessed; empty when all are met |
| A gap adds more than one need, or enrols someone, or creates a certificate, or is added for an unassessed skill | the need tests: exactly one need; enrolments and certificates unchanged; refused with no gap or for another course |
| A skill level changes pay, status, a certificate, an appraisal or a promotion | the "changes nothing" test: identical before and after |
| The employee reads another person's assessment | the "what the employee reads" test: exact fields, no other person's text |
| A comment leaks to the audit log, survives erasure, or erasure touches someone else | the audit and erasure tests |
| Another company reads or changes anything | the tenant isolation test |
| The migration loses data | round trip (up, down, up) on a copy of the seeded database: counts unchanged, schema identical |

## Assumptions (my recommended answers to the plan's questions; change any of them)

1. Scope: library, role requirements, assessment, gap view and a derived learning path. 2. **Four fixed levels** (the founder's names: Basic, Developing, Proficient, Advanced). 3. **A manager assesses direct reports; HR anyone.** 4. **No self-assessment yet.** 5. **A skill level is never read beside an appraisal.** 6. **A career-path warning does not mention a skill gap yet.** 7. **The employee reads the full history.** 8. **The auditor reads assessments** (`hr.view`). 9. **Skills link to courses by course name.** 10. **Stale assessments are listed after 365 days** (HR policy; 0 = never), never a block or a score.

Smaller choices you did not ask for: **a skill with no course linked cannot create a need** (the button shows "No course linked"); **a skill switched off drops out of the gap view and the learning path** but its assessments are kept; **only skills of the person's role appear on My skills** (a skill assessed earlier for another role is kept in the data but not shown until the role needs it).

## What I did not do or test

- A lawyer should review the wording an employee sees about assessments and how long they are kept (`docs/plans/decisions-and-lawyer-review.md`).
- **Not built:** a skill level read beside an appraisal or used for hiring or promotion, ranking or scoring people, self-assessment, a company-defined scale, automatic suggestions of people for a role, peer assessment, costs.
- Browser checks are reported in the task report (what was seen on screen and what was not).
