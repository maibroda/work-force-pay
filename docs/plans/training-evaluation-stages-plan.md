# Training evaluation, richer: three stages

Written 2026-11-11. **A proposal only: nothing is built and no migration is written until you answer the questions in section 7 and say "go".** It is item 8 of `docs/plans/founder-decisions-2026-11-10-hr.md` ("Training evaluation, richer: needs a small plan"). **No money is involved**, and nothing here changes pay, status, a certificate, an appraisal or a promotion. It is not a critical module in CLAUDE.md terms (no pay, statutory, approval or access-control rule changes), but it adds a migration, so it needs your "go" for that.

## 1. What your register asks for

Three stages: (1) the **participant** evaluation covers **relevance, content, facilitator and delivery**; (2) the **manager** evaluation of **application** on the job; (3) an **effectiveness** evaluation of whether the training **improved job performance**, **measured separately from attendance**. Confidential but identifiable; individual answers not visible to ordinary managers; aggregated results only from five answers; the employee sees the manager's evaluation. The register also allows HR to read individual responses "only where authorised and necessary"; the current build is stricter (never by name), and you are asked to confirm that (question 2).

## 2. What exists today (checked in the code on 2026-11-11)

- **`TrainingEvaluation`** (one row per attended enrolment and kind): a **participant** answer (one rating 1 to 5, "was it useful for my work", and an optional comment up to 300 characters) and a **manager** answer (was it applied on the job, rating and comment) asked **60 days after the session** (`trainingEvaluationDays`, 0 = never), for a **direct report who attended** only.
- **What HR sees** (`programmeResults`): per programme, the participant's count and average, and the comments, **only from five answers**; below five nothing (not even a count). **A participant's answer is never shown by name.** The manager's evaluations are listed by name; the **employee reads the manager's evaluation** of them.
- **Not built:** the participant's separate views of content, facilitator and delivery; any measure of **effectiveness**; a way to say which programmes are worth evaluating that far.
- **Related, already built and reusable:** skill assessments (a level per skill, history kept) and `Skill.courses` (which courses build a skill); sessions have an optional `trainer` name.

## 3. The design

**Stage 1: the participant, four questions.** The existing question ("was it useful for my work", the stored `rating`) **is the relevance question and keeps its meaning**, so every existing answer stays valid and comparable. Three more ratings are added: **content**, **facilitator** and **delivery**, each 1 to 5, plus the optional comment (300 characters). One minute to answer, optional, once per attended course, as today. The facilitator question is a rating of the **delivery of this course**, not of a named person.

**Stage 2: the manager, application.** Unchanged: 60 days after the session, once, for a direct report who attended.

**Stage 3: the effectiveness evaluation (new).** Asked of the **manager** a company-set number of days after the session (proposed **120**; 0 = never), **only for programmes HR has marked "evaluate effectiveness"** (a flag on the programme, default off, so a fire-safety briefing does not burden managers). One answer per attended enrolment:
- **Did the person's performance on the work this training targets improve?** Four choices: **Clearly improved**, **Somewhat improved**, **No visible change**, **Not yet visible** (the manager has had no chance to see it, so they are never forced to judge). An optional comment (300 characters) for the evidence.
- **Separate from attendance:** attendance, a certificate or a good participant score never fills this in or counts toward it. It is its own record, by the manager, about outcomes.
- **Evidence beside it, never a score:** where the programme builds a skill (`Skill.courses`), the manager sees that skill's assessments **before and after** the session, read-only, with "not assessed" shown as such. Nothing updates a skill level automatically.
- **The employee reads it**, as they read the manager's application evaluation.

**What HR sees.** Per **programme** only (never per session, never per person): from **five answers** the average of each of the four participant ratings, and the spread of effectiveness answers (counts per choice, "not yet visible" shown apart). **Below five, nothing**, as today. The participant's comments are shown unnamed and in alphabetical order, from five answers, as today. **No view lists who answered what for participants.** HR also sees which managers' evaluations are due, never a participant's.

**Reminders.** The HR digest gains one line, "Effectiveness evaluations the manager has not given", once due (the existing line for the 60-day evaluation is unchanged).

## 4. Data, migration, permissions

- **Migration (additive, reversible, round-tripped up/down/up on a copy of the seeded database):** three nullable rating columns on `TrainingEvaluation` (content, facilitator, delivery); a new table `TrainingEffectiveness` (one row per enrolment: the four-way outcome, an optional comment, who and when) so **no enum value is added to an existing type** (Postgres cannot drop one); one boolean on `TrainingProgramme` (evaluate effectiveness, default false); one `HrPolicy` column (days before the effectiveness question, default 120). No existing column changes meaning. The down script drops only what the migration added.
- **Pure functions first** (`src/lib/training-evaluation.ts`): the effectiveness due date, the four outcomes, the per-dimension summaries reusing `summariseRatings`, the minimum group for the outcome spread, and the rule that "not yet visible" is counted apart. **Unit tests first.**
- **Permissions:** none new. The manager acts for **their own direct reports** only (`training.request`, as for the application evaluation); results need `hr.view`; the employee reads their own. The participant's answer is stored with their id (so each person answers once) and **no query for HR selects it**.
- **Audit:** ids, the kind and the stage, never a comment. **Personal data:** the comments and the manager's effectiveness answer are in the employee's copy of their data where they are about the employee, and removed on erasure (the shape stays); participant comments are removed on erasure of the participant.

## 5. Tests first

Unit: the due dates for stages 2 and 3; the four outcomes; each dimension's summary hides below five; "not yet visible" never counts as an improvement or a failure. Integration, written before the code: the participant answers four ratings once, only for a course attended, and **existing single-rating answers still read as relevance**; HR sees no name or id on any participant answer and nothing below five (per dimension and for comments); effectiveness can be given only by the manager of a direct report who attended, only after the company's days, only for a programme marked for it, once; HR and the employee read the manager's answer; a manager of someone else's report is refused ("not found"); the skill before-and-after evidence agrees with the skill assessments and shows "not assessed" apart; setting 0 switches stage 3 off; another company sees nothing; the digest line appears only when due; erasure removes the comments and keeps the shape; the audit log carries no text.

## 6. Not in this step

Costs, budgets or a return-on-investment figure (money rules needed); any effect on pay, an appraisal, a promotion or a certificate; automatic skill updates; effectiveness asked of the participant themselves or of peers; a per-trainer or per-session result (see question 5); notifications by email or SMS; anything about what a lawyer must review (the wording an employee sees and how long evaluations are kept; the retention schedule is governance step 3).

## 7. Questions for you (my recommendation in bold)

1. **Participant questions:** keep the existing "useful for my work" as **relevance** and add **content, facilitator and delivery**, with one comment. **Yes.**
2. **Keep it stricter than the register:** HR **never** reads a participant's answer by name, even "where authorised and necessary". **Yes, keep it.** The alternative (a Company Administrator could open one response with a recorded reason) breaks the promise made to participants; I would not build it without your explicit word.
3. **Effectiveness asked 120 days after the session**, as a company setting (0 = never). Right number? (90 or 180 are reasonable; managers need time to see a change.)
4. **Only for programmes HR marks "evaluate effectiveness"** (default off). **Yes.** Or should every attended course be asked?
5. **Results per programme only.** A rating of the **facilitator** is shown across all sessions of a programme, never per session or per named trainer (sessions are small and a name makes it a rating of a person). **Yes.** Say so if you want a per-trainer view; it would keep the five-answer minimum and the wording would need your lawyer.
6. **Four outcomes including "Not yet visible"**, so a manager is never forced to judge. **Yes.**
7. **Skill assessments before and after, read-only, as context**; never an automatic skill change. **Yes.**
8. **The employee reads the manager's effectiveness answer**, as they read the application one. **Yes.**
9. **It never feeds an appraisal, pay or promotion.** **Yes.**
10. **Minimum of five answers** for every aggregated figure and for comments, as now. **Yes.**

## 8. Order of work once you say "go"

One pull request with one small migration: (1) the pure rules and unit tests; (2) the integration tests, written to fail; (3) the schema and migration, round-tripped; (4) the four-question participant form and the stage 3 form for the manager, with the skill evidence; (5) the programme flag and the HR policy setting; (6) HR results per programme and the digest line; (7) the employee's view, their copy of their data and erasure; (8) docs, the explain-back note and the full suite; (9) browser checks as a participant, a manager, HR, the employee and another company, and a report.
