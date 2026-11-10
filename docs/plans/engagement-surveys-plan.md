# Engagement surveys: a proposal

Written 2026-11-10. **A proposal only: nothing is built and no migration is written until the founder answers the questions in section 6 and says "go".** This is "engagement surveys", which the welfare and recognition plan set aside because they "need their own anonymity design: a minimum group size, no identifiable answers, and a decision on how guards without a smartphone take part". The design below is mostly about that anonymity. **It involves no money.**

## 1. What exists today (checked in the code on 2026-11-10)

- **Individual feedback and evaluation, always by name or confidential:** continuous feedback (the employee always reads it), appraisals, recognition, and training evaluation (a participant's answer is confidential and shown only from five answers).
- **A rule for small groups** that hides counts below five (`MIN_GROUP`, used by the welfare summary and training evaluation).
- **Employee logins:** an employee who has a login is linked to their employee record and sees **My HR** pages. **Not every employee has a login**: many site guards do not.
- **Departments and employee categories** exist and could group results.
- **Not there:** any way to ask the whole workforce (or part of it) a few questions and learn how people feel, without knowing who said what.

## 2. What this adds (step 1)

1. **A survey** (HR > **Surveys**): HR writes a title and a short introduction, picks **who is invited** (everyone, one role or one department), sets **opens** and **closes** dates, and adds **up to 15 questions**. A question is a **statement answered on a five-point scale** (strongly disagree to strongly agree) or **one optional open comment** (up to 500 characters). There is no other question type in this step.
2. **Taking it** (**My surveys**, My HR): an invited employee with a login sees the open surveys and answers once, any time before it closes. They can skip any question. It takes a few minutes and works on a basic phone.
3. **Real anonymity by design**, in three separate records:
   - **Who was invited and who has taken part** is a participation record (survey, employee, day answered). It exists only so nobody answers twice. **No page, report or export lists who took part or who did not**; HR sees only **counts**.
   - **The answers** are stored with **no link to the person**: no employee id, no user id, no time (only the survey), and a **random identifier** (not one that orders them in time), so an answer cannot be matched to a participation record by when it was written.
   - **The group** an answer belongs to (role, department) is stored only to allow a breakdown, and is **shown only when safe** (below).
4. **Results**, once the survey **closes** (never while it is open, so nobody can watch the numbers move): per question, the number of answers and the distribution and average; **only from five answers**. A **breakdown by role or by department** is shown only for groups with **at least five answers**, and **if exactly one group would be hidden, the next smallest is hidden too**, so a hidden group cannot be worked out by subtraction. **Comments** are shown **unnamed, with no group label, in alphabetical order and only from five answers**. HR may **hide a comment** (for example one that names a person), with a recorded reason.
5. **Participation** is shown as counts (invited, took part) overall and for groups of at least five. The **employee** sees only which surveys are open to them and whether **they** have answered.
6. **"What we are doing about it":** after closing, HR can write a short note for each survey that **every invited employee can read** on My surveys.
7. **HR digest:** one line while a survey is open (how many days are left and the overall participation count).

## 3. The rules in plain terms (with a worked example)

- **Nobody can list who answered.** The participation record is read only by the code that stops a second answer and that counts participation. It is not shown by any page, not in a report and not in a person's copy of their data beyond "you took part in this survey on this day".
- **Answers cannot be tied to a person even by someone with database access, as far as the design allows**: no person id, no timestamp, a random identifier, and the group fields only for a breakdown. (A group of one would identify them, which is why a breakdown is shown only from five answers, with the next-smallest rule.)
- **Small surveys are refused or merged:** a survey invited to fewer than **ten** people (a small department) cannot be created for that group alone, because five answers would be half of them. HR widens the audience, or the survey is run for the whole company.
- **Results wait for the close and for five answers.** Under five answers nothing is shown, not even a count of answers by group.
- **A survey changes nothing about a person**: no pay, status, appraisal, feedback or case. It is not used in any decision about an individual, and the page says so.
- **Personal data:** because answers carry no person, they are **not** in a person's data copy and **erasure** has nothing to remove from them. The participation record (survey and day) is in the data copy, and erasure anonymises it. **Audit entries carry survey ids and counts only.**
- **Worked example:** HR opens "Working here, November": invited are all 110 employees, 12 questions and one comment, open for 14 days. 64 of the 110 have a login and answer. After it closes, HR sees: 64 took part, "I feel safe at my site" averaging 4.1 with the distribution; by role, Guards 38 answers, Supervisors 9, **Office staff 3 (hidden: fewer than five)** and, because one group is hidden, the **next smallest, Supervisors, is hidden too**; 18 comments, shown unnamed. One comment names a supervisor: HR hides it with a reason. HR writes "We are changing the night shift handover from January", which every invited employee can read. At no point can HR or anyone else see who took part or who did not.

## 4. Files, migration, permissions and tests (once approved)

- **Migration (one, additive, reversible, round-tripped on a copy of the seeded database):** one enum (survey status), five tables (`Survey`, `SurveyQuestion`, `SurveyParticipation`, `SurveyResponse`, `SurveyAnswer`). The response and answer ids are random (UUID), and neither carries a person or a time.
- **Permissions:** `survey.manage` (create, open and close a survey, hide a comment, write the follow-up note): the **HR administrator** (question 6); reading results uses `hr.view`. Taking a survey needs only a login linked to an employee.
- **Pure functions first** (`src/lib/survey.ts`): the distribution and average, the **small-group and next-smallest rule** for a breakdown, the minimum audience, the open and closed windows, and the participation counts. **Unit tests first**, including the subtraction case.
- **Services and screens:** HR > **Surveys** (create, open, close, results, follow-up note); **My surveys** (My HR); a digest line; entry modules and navigation; release notes, data dictionary, explain-back note. **Every employee-facing query selects only the fields it returns.**
- **Tests (integration, written first):** the stored answer has no person, user or time field and a non-ordering id; an employee answers once and a second try is refused; an employee not invited cannot answer; nobody can list who took part (no service returns the participation rows to a caller, HR included); results are refused while open and under five answers; a breakdown hides a group under five **and the next smallest** when exactly one is hidden; comments are unnamed, unlabelled and hidden below five; a hidden comment disappears from results with a recorded reason; a survey invited to fewer than ten people is refused; the employee sees only their own participation and the follow-up note; another company sees nothing; the audit log carries ids and counts only; erasure anonymises the participation record.

## 5. Not in this step

**Paper or assisted answering for employees without a login** (question 5), **notifications and reminders** (none are sent; reminders would also need to know who has not answered, which this design refuses to know), **question types** other than the five-point scale and one comment, a **question library** and **benchmarks**, **manager-level results** for a manager's own team (question 7), **action tracking** beyond the follow-up note, **scheduling** repeat pulse surveys automatically, **scoring any person or team**, and any link to pay or appraisal.

## 6. Questions for the founder (my recommended answer first)

1. **Is five the right minimum answers before anything is shown?** **Recommended: yes**, as for the welfare summary and training evaluation.
2. **A minimum audience of ten for any group a survey is run for?** **Recommended: yes**, so five answers are not half the group.
3. **May HR see who took part, or only counts?** **Recommended: only counts.** The design stores who took part solely to stop a second answer.
4. **Breakdowns by role and department only** (no others, and never a combination)? **Recommended: yes.**
5. **Employees without a login** (many site guards): **online only in this step**, shown honestly in the participation counts; and, if participation among guards is low, a **paper batch** step later (HR keys the counts from a bundle of anonymous paper forms for a site, never a form by name). **Agree?**
6. **Who runs surveys: the HR administrator alone (`survey.manage`)?** **Recommended: yes.** The company and super administrators would then not hold it, as for welfare and succession.
7. **May a manager see results for their own team?** **Recommended: not in this step**; if wanted later, it follows the same five-answer and next-smallest rule.
8. **May HR hide a comment** (with a recorded reason)? **Recommended: yes**, for a comment that names or identifies a person; hiding shows nothing to employees.
9. **Retention:** keep answers for how long? **Recommended: delete the raw answers after 24 months, keeping nothing individual**; the distribution per question could be kept as a frozen summary. (A lawyer should confirm what the Nigerian data protection rules ask for anonymous data.)
10. **Open for how long, and may it be reopened?** **Recommended: 7 to 30 days, set by HR; a closed survey is never reopened** (a new survey is created), so results do not change after they have been read.

**Risks:** anonymity is a promise to employees that must hold in practice, not only on paper: the guards are the design test (a small, well-known group on a site). The safeguards are the minimum audience, the five-answer rule with the next-smallest hiding, no timestamps or person on an answer, and no list of who took part. A lawyer should review the wording an employee sees about anonymity, the retention of answers and whether anonymous survey data is personal data under the Nigerian rules.
