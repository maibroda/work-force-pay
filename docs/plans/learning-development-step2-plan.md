# Learning and development, step 2: manager training requests, my required training and training evaluation

Written 2026-11-10. **A proposal only: nothing is built and no migration is written until the founder answers the questions in section 6 and says "go".** Step 1 (training needs, a calendar, enrolment, attendance that creates the certificate record) is merged (#170). This is the next slice of "the rest of L&D". **It involves no money**: costs and budgets are deliberately left for a step of their own, because they need your rules.

## 1. What exists today (checked in the code on 2026-11-10)

- **Programmes, sessions, enrolments and attendance** (`TrainingProgramme`, `TrainingSession`, `TrainingEnrolment`); marking someone **Attended** creates their certificate record through the same function HR uses by hand, so the compliance check and the HR digest are unchanged.
- **Training needs** (`TrainingNeed`): a person who needs a course, with a source (**compliance gap, appraisal, request, other**), a priority, a due date and a status (open, planned, met, dropped). **HR alone adds them**; the Training needs page also lists compliance gaps with no session yet.
- **My training** (My HR): the employee's own upcoming sessions and attended courses, read-only. It does **not** show what they are required to hold.
- **Compliance** (`src/lib/training-compliance.ts`): required courses by category, with a grace period for a new joiner, worked out from the certificates held. It is shown to HR (Training compliance) and in the HR digest, **never to the employee**.
- **Reuse available:** the rule for who may act on whom (a manager about a direct report, HR about anyone, nobody about themselves: `mayGiveFeedback`), the minimum group size that hides small counts (`MIN_GROUP = 5`, used by the welfare summary), the maker and checker pattern, and the data copy and erasure hooks.
- **Not there:** a manager asking for a course for a team member, the employee seeing their own required training, and any way to tell whether a course made a difference.

## 2. What step 2 adds

1. **Manager training requests.** A manager asks for a course for **one of their own direct reports** (HR for anyone), with a few plain sentences of why. **HR decides**: accepting turns it into an ordinary training need (source "request") that HR then plans as today; declining needs a reason. The requester cannot also decide it. **The employee is not told of a request at all in this step** (a need is HR's planning list, as in step 1): they see their required training and the sessions they are enrolled in, never a request that was declined or is still being considered.
2. **My required training** (added to **My training**): for the employee, the courses the company requires of their role, each as **Valid (with expiry), Expiring soon, Expired, Missing or Due as a new joiner**, read from the existing compliance check. Their own record only. It tells them what to ask for; it changes nothing and does not lower or raise anything about them.
3. **Training evaluation**, in two short questions per attended course:
   - **The participant** is asked, once, shortly after attending: *was this useful for your work?* (1 to 5, with an optional comment of up to 300 characters). It is optional.
   - **The manager** is asked, once, **60 days after the session** (a company setting, 0 = never): *has it been applied on the job?* (1 to 5, with an optional comment) for **their own direct report**. The employee **reads it**, as they read feedback: there are no private notes about a person's performance.
   - **HR sees results per programme as counts and averages, and a group of fewer than five responses is shown as "fewer than 5"**, so nobody can be picked out. The participant's comment is shown to HR **without a name, and only once five people have answered**. Evaluations **change nothing**: no pay, no status, no certificate, no appraisal score. HR may use them to decide on a need or to drop a programme.
4. **The HR digest** gains one line: evaluations due from a manager (sessions that passed the 60 days with no manager answer).

## 3. The rules in plain terms (with a worked example)

- **Who may request for whom:** HR about anyone; a manager only about their own direct reports (anyone else is "Employee not found"); nobody about themselves; the employee, the auditor and finance cannot request. Someone with the training permission (`hr.manage`) decides; **the requester never decides their own request**. An inactive employee cannot be requested for; the same person cannot have two open requests for the same course (matched the way compliance matches course names).
- **Accepting changes nothing about the person** beyond adding a training need to HR's list. It does not enrol them, book a seat or create a certificate.
- **Evaluation is about the course, not a score on the person.** The participant's answer is stored against their enrolment so each person answers once; **HR never sees it by name**. The manager's answer is by name, is read by HR and the employee, and may be given only for the manager's own direct report who **attended**.
- **My required training is read-only and shows only the signed-in employee's own record.** It reads the same compliance function as the HR screen, so there is one rule, not two.
- **Worked example:** Sade (a supervisor) asks for "First aid" for Gbenga, a guard whose certificate expires in 5 weeks; HR (Ngozi) accepts, so Gbenga now has a training need "First aid, request", and his **My training** page already shows "First aid: expiring soon, 14 Dec". Ngozi puts him on the 20 November session and marks him Attended; his certificate is created (step 1). He is asked "was it useful?" and answers 5. **Sixty days later** Sade is asked "has it been applied?" and answers 4 with a line of comment; Gbenga can read it. The programme's page shows, for First aid, 11 responses, an average of 4.2, and the participants' comments with no names. Had only 3 people answered, HR would see "fewer than 5" and no comments.

## 4. Files, migration, permissions and tests (once approved)

- **Migration (one, additive, reversible, round-tripped on a copy of the seeded database):** one enum (the kind of evaluation: participant or manager), two tables (`TrainingRequest`, `TrainingEvaluation`), one HR policy column (days before the manager is asked, default 60). **No existing enum or table changes**, so the down script drops only what the migration added.
- **Permissions:** one new, `training.request` (HR administrator, supervisor and operations manager; managers limited to their direct reports, as `recognition.nominate` and `career.propose`). Deciding a request and reading the results use the existing `hr.manage` and `hr.view`.
- **Pure functions first** (`src/lib/training-evaluation.ts`): when a manager's evaluation is due, who may be evaluated by whom, the rating and comment limits, the minimum-group rule applied to a programme's results (reusing `hideSmallGroups`), and the request's status moves. **Unit tests first.**
- **Services and screens:** HR > Learning & development > **Training requests** and **Evaluation results**; **My team's training** (managers: ask and see their requests; answer the evaluation due); **My training** extended (required courses, and the one-question evaluation after a course); the data copy and erasure; navigation and entry modules; release notes, data dictionary, explain-back note.
- **Tests (integration, written first):** a manager requests only for a direct report, never for themselves; the requester cannot decide; accepting creates exactly one training need and nothing else; a declined or undecided request is invisible to the employee; **My required training agrees with the HR compliance screen for the same person** (one rule) and shows no one else's; a participant evaluates once, only a course they attended; HR sees no name on a participant's answer, and **a group of fewer than five shows no count, no average and no comment**; the manager evaluates only a direct report who attended, after the due date, once; the employee reads a manager's evaluation of them but never a participant's; evaluation changes no pay, status, certificate or score; tenant isolation; roles refused; audit by ids only; erasure removes the free text and keeps the shape.

## 5. Not in this step (and where it goes)

**Costs, budgets and training spend** (need your rules: naira, who approves spend); **skills-gap analysis** (needs a skills model per role and each person's level, which is a larger design of its own); **learning paths** (an ordered set of courses for a role; it fits better once skills exist, and can link to the career paths already merged); a **waiting list**; **trainer and venue management**; **external bookings**; **notifications** about a session or an evaluation (email or SMS); the **employee requesting their own training**; and any change to how compliance is worked out.

## 6. Questions for the founder (my recommended answer first)

1. **Should this step be requests, my required training and evaluation**, with skills, paths and costs after? **Recommended: yes.** It closes the loop (ask, deliver, learn whether it helped) without new money rules or a skills model.
2. **May a manager request for their direct reports, with HR deciding?** **Recommended: yes.**
3. **May the employee request their own training?** **Recommended: not yet**; they see what they lack on My training and tell their manager.
4. **Is the participant's answer confidential, not anonymous?** Stored against their enrolment so each answers once, never shown to HR by name, shown only in groups of five or more. **Recommended: yes.** (Fully anonymous would need dropping the link to the person, so one person could answer twice.)
5. **Does the employee read the manager's evaluation of them?** **Recommended: yes**, as they read feedback.
6. **Sixty days after the session for the manager's evaluation?** **Recommended: yes**, as a company setting (0 = never).
7. **Is five the right minimum before results are shown?** **Recommended: yes**, the same as the welfare summary.
8. **Should the employee's required-training view show the grace period for a new joiner** ("due by 12 Jan")? **Recommended: yes.**
9. **Should the evaluation ever feed an appraisal?** **Recommended: no**; it changes nothing about a person, and the appraisal reviewer already reads feedback and certificates.
10. **Which comes after this?** **Recommended: skills-gap analysis and learning paths together**, then costs once you have given the rules.

**Risks:** an evaluation can feel like surveillance of the participant: the safeguards are that it is optional, confidential, never shown by name to HR and hidden in small groups. A lawyer should review the wording an employee sees and how long evaluations are kept.
