# Explain-back note: training evaluation in three stages

For the founder. Plain language. Plan: `training-evaluation-stages-plan.md` (the merged plan of #187). **You approved all ten recommendations on 2026-11-14.** It is not a critical module in CLAUDE.md terms: it touches no money, no pay, no statutory setting and no approval. It does handle personal opinions and keeps a promise to participants, so I wrote it as if it were. **One small, additive migration.**

## The three stages, in plain words

1. **The participant** (about the course). Four questions, each 1 to 5, plus an optional comment of 300 characters: **was it useful for my work** (the question that already existed, so every old answer stays valid), **the content**, **the facilitator**, **how it was delivered**. Answered once, for a course they attended.
2. **The manager, application** (unchanged): 60 days after the session, "was it applied on the job?", for a direct report who attended.
3. **The manager, effectiveness** (new): **120 days** after the session (a company setting; 0 = never), **only for programmes HR has marked**, "did the person's performance on the work this training targets improve?" Four answers: **clearly improved, somewhat improved, no visible change, not yet visible** (so a manager is never forced to judge), with an optional comment.

## What the code does, step by step

1. **A participant** answers the four questions. Each of the three new ratings is optional in the rule (so an old single-rating answer still works and reads as "relevance"); the form asks all four.
2. **HR marks a programme** "ask managers about effectiveness" (a switch on the programme, off by default, so a fire-safety briefing does not burden managers). The 120 days is an HR policy setting.
3. **When it is due** (attended, the programme marked, the days passed, not already answered), the manager of the direct report sees it on "My team's training" **with the skill evidence beside it**: for each skill the course builds, the latest assessment **before** the course and the latest **after**, or "not assessed". Evidence is **read only**: nothing updates a skill.
4. **The manager answers once.** HR may answer for anyone, as for the application evaluation. A manager of someone else's report is told only "not found". Nobody answers about themselves.
5. **The employee reads the answer** about them, with the comment and who gave it, on "My training".
6. **HR sees results per programme only** (never per session, never per trainer, never per person), **and only from five answers**: the average of each of the four participant ratings (each on its own answers), the participants' comments **unnamed and in alphabetical order**, and the **spread of effectiveness answers** with **"not yet visible" counted apart** (it is never an improvement or a failure). **Below five, nothing, not even a count.** HR **does not** see who was evaluated or what the manager wrote for stage 3, and **no query HR uses ever fetches a participant's id or name**.
7. **The HR digest** gains one line: "Effectiveness evaluations the manager has not given", once due, for marked programmes.
8. **The employee's own copy of their data** includes their four ratings and the manager's effectiveness answer about them. **Erasing a former employee** removes the comments (theirs and the manager's about them), **keeps the ratings, the outcome and the shape**, and leaves the audit log.
9. **Nothing here changes pay, a skill, an appraisal, a promotion or a certificate.** A test checks the counts of each before and after.

## A worked example

Tunde's Security Co. runs "First aid" for six guards over the year. HR marks the programme for effectiveness. Each guard answers the four questions (confidentially: HR will see only the programme's averages once five have answered). 120 days after Ada's session her supervisor Sade gets a prompt on "My team's training": First aid skill, **before the course level 3 on 4 March, after level 5 on 6 July**, and the choices. Sade answers **"Clearly improved"** with a line about Ada leading the drill. Ada reads it. HR's page shows First aid with, once five supervisors have answered, **Clearly improved 2, Somewhat improved 1, No visible change 1, Not yet visible 1 (counted apart)**, never naming Ada.

## What could go wrong, and which test proves it does not

| Risk | Test (`tests/integration/training-evaluation-stages.test.ts`, `tests/unit/training-evaluation.test.ts`) |
| --- | --- |
| HR can identify a participant | "carries no name and no id of a participant" (names, user ids, the trainer), "is nothing below five answers" for each of the four ratings and the comments |
| A small group is revealed | the below-five tests; "counts each rating on its own answers" (five relevance answers but four content answers hides content) |
| Facilitator rated per trainer or per session | "is per programme across all its sessions, never per session or per trainer" |
| The manager is forced to judge | the unit tests on the four outcomes and "not yet visible"; "takes one of four outcomes ... 'not yet visible' is a legitimate answer" |
| Effectiveness asked of everything, too early, or twice | "refused for a programme HR has not marked", "switched off", "before the days have passed", "once" |
| Someone else's manager sees or answers | "is the manager's alone: another manager gets 'not found'", the evidence "not found" test |
| It changes pay, skills, appraisals | "changes no pay, no skill, no appraisal and no promotion"; "evidence is read-only" |
| The employee cannot read what is said about them | "what the employee reads" and "the employee's own copy of their data" |
| Erasure leaves comments or breaks the shape | "erasing an employee removes the comments ... and touches no one else's" |
| A comment reaches the audit log | "carries ids, the stage and the outcome, never a comment" |
| Another company sees anything | "another company sees none of it" |
| An old answer breaks | "still accepts the single-rating answer of before"; the existing evaluation tests pass unchanged |

## What I did not do, and what to know

- **No existing test changed.** The existing evaluation tests pass unchanged.
- **Not built (as the plan said):** costs or return on investment, any effect on pay, appraisal, promotion or certificate, automatic skill updates, effectiveness asked of the participant or of peers, a per-trainer or per-session result, email or SMS notices.
- **HR cannot read a stage 3 answer by name.** This is stricter than the application evaluation (which HR lists by name), as the plan said. The employee and the manager can.
- **The wording an employee sees, and how long evaluations are kept,** are for the company's lawyer, not decided here.
- **A bug found in the browser check, fixed in this change:** a company that has never had an HR policy row gets one on its first read, and the evaluations page now reads the policy twice at the same moment (the application evaluation and the effectiveness one). **Two simultaneous first reads raced to create it, so one failed and the page returned an error** (it showed for the second demo company). `getHrPolicy` was an upsert, which is a read then an insert; it now reads, then inserts "and do nothing if already there", then reads again, which is safe against the race and inside a transaction. **Test:** "the company's HR policy is created once, even when it is first read twice at the same moment" (it failed every time before the fix). This affected any page that read the policy twice at once for a brand-new company, not only this one.
- **Browser check (demo app, synthetic data, removed afterwards):** HR marked a programme through the programme table (audit: the field name only); the supervisor saw exactly the one evaluation that was due, with the skill evidence read-only (level 2 before the course, level 4 after), answered it, and the audit entry held only the enrolment id and the outcome; the employee answered the four questions and then read the manager's answer about them; HR's results page showed "fewer than 5" for every figure and no name; another company saw none of it. **Not browser-checked:** the auditor and finance roles, and what HR sees from five or more answers (covered by the integration tests).
- **"Facilitator" is rated for the programme,** across all its sessions, so a result is never a rating of a named person.
