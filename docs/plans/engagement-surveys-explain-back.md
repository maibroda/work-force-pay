# Explain-back note: engagement surveys, anonymous by design

Branch `surveys-build` (stacked on `skills-build`). One migration, `20261207090000_engagement_surveys` (additive: three enums, seven tables, one HR policy column). This touches **personal data and access control** and adds the **only new unauthenticated address** in the HR area (the survey page reached from a QR code or a shared device), so please read it. Built on your "go" of 2026-11-10 to the plan `docs/plans/engagement-surveys-plan.md` as revised by `engagement-surveys-plan-revision.md` and your decisions of that day. **No money is involved, and a survey changes nothing about any person.**

## The one choice that needs your confirmation

Your register calls answers "confidential" and speaks of deleting "identifiable raw responses". **I stored answers with no link to the person at all**, which is stricter. There is nothing identifiable to delete: the raw answers themselves are deleted at 24 months, and the anonymised result is kept. **My recommendation is to keep this**, because on a small site an identifiable answer is a risk to the person even if HR cannot browse it. If you want identifiable-but-confidential answers instead, the design changes (answers keyed to the person, readable by no screen), so please say so before this is merged.

## The rules, step by step

1. **A survey** is built by the HR administrator alone (`survey.manage`) in draft: a title, an introduction, up to 15 questions (a statement rated 1 to 5, or an optional comment of up to 500 characters), the audience (everyone, one role or one department) and the opening and closing days. Questions change only while it is a draft.
2. **Opening makes the codes.** Every invited employee still at the company (active or on leave) gets **one random, single-use access code** (12 characters from an alphabet without look-alike characters, shown in groups of four). The server stores **only a hash**. The plain codes are returned **once**, in a sheet for HR to print and hand out; they cannot be shown again. A lost code is reissued for one person: the old one is cancelled. **If that person had already taken part, the new code is created already cancelled and HR is shown a code all the same**, so asking for a replacement cannot tell HR who took part.
3. **Three ways to answer, one rule.** (a) An employee **with a login** answers in My surveys. (b) Anyone **without a login** opens the survey address (a QR code can point to it) and types their own code, on their phone or a **shared company device**. (c) In an **assisted session** an authorised HR representative (permission `survey.assist`, held by the HR administrator, never a supervisor) starts a session (recorded: the survey, the day, the device, never who took part), hands the device to the employee, who types their own code and answers alone. After each person the page resets for the next. The system cannot technically stop a supervisor standing behind someone: that control is who is allowed to run a session and the written instruction to them.
4. **The code and the answer are separated at the moment of use.** In one step the code is marked used (and the day recorded) and the answer is stored **with no person, no user, no time and a random identifier** (a UUID, not one that sorts by time). After that nothing in the application links the code, and so the person, to the answer. **A submission is never written to the audit log.**
5. **A wrong, used, cancelled or other survey's code, and a closed survey, all get the same reply** ("invalid"), so the page reveals nothing about which codes exist. A person who keeps guessing is slowed down by address (30 tries a minute for a survey).
6. **Nothing is shown before the close, or below five answers.** Per question: the count, the average (one decimal, half up) and the distribution, only from five answers. A **role or department is shown on its own only with at least ten invited and five answers**. A group under ten **may take part**: only its display is suppressed. Hidden groups are combined into one "other" row, shown only if that row is itself large enough; **if exactly one group would be hidden, the smallest group that could be shown is hidden too**, so a hidden group cannot be found by subtracting the shown groups from the total.
7. **Comments** are shown from five answers, **unnamed, with no role or department, in alphabetical order** (so the order of answering reveals nothing). HR may **hide** a comment with a recorded reason (for example one that names a person); nobody is told which one.
8. **What HR sees about participation is counts only:** how many of the invited took part, overall and by role where the group is large enough. No service returns the access-code rows' employees to any caller, and no page lists them.
9. **After the close,** HR writes a short **follow-up note** that every invited employee can read in My surveys.
10. **Keeping answers for a limited time.** Raw answers and codes are deleted **24 months** after the survey closed (HR policy; **0 = never**), by a run HR triggers (it is audited by survey and counts only). The **anonymised result is kept**, without the comments (they are raw words).
11. **The employee's data copy** lists only the surveys they took part in and the day, never an answer. **Erasure** has nothing of theirs to remove from the answers (they carry no person).

## A worked example

HR opens "Working here, November" for all 110 employees. 64 have a login and 20 more answer with a code on a shared tablet at a site; 26 do not take part. When it closes, HR sees: 84 of 110 took part; "I feel safe at my site" averaging 4.1 with its distribution; by role, Guards (60 invited, 51 answers) and Supervisors (12 invited, 9 answers) shown; **Office staff, 3 invited, 3 answers, not shown on its own**, and because exactly one group is hidden, **Supervisors is hidden too**, and the two are combined (15 invited, 12 answers: shown as "other roles"). 18 comments, shown unnamed in alphabetical order; one names a supervisor and HR hides it with a reason. HR writes "We are changing the night handover from January", which every invited employee reads. At no point can HR or anyone see who took part or who did not, or which answers are whose.

## What could go wrong, and what proves it does not

| Risk | Test |
| --- | --- |
| Anyone but the HR administrator runs, reads the counts of, or assists a survey | `survey.test.ts`: the administrators, manager, auditor, finance and employee are refused (the auditor reads the list and results like other HR records) |
| An answer carries a person, a user or a time | the "no person, no user, no time" test checks the exact fields of a response and an answer, a UUID id, and that neither the user id nor the employee id appears |
| A code is stored in the clear or can be reused | codes are stored as 64-character hashes and the plain code is nowhere in the table; a second use, a wrong, cancelled or other survey's code all fail the same way |
| HR can tell who took part | no list, detail or result carries a name, an employee id or a code; reissuing for someone who had taken part still returns a code and the answer looks the same |
| Results are read while the survey is open, or from too few answers | refused until it closes; below five nothing is shown, not even a count |
| A small group is shown, or found by subtraction | the unit tests of the breakdown (including the hide-a-second-group case) and the integration tests with six and twelve guards and one supervisor |
| A comment leaks a name | hidden comments are gone from the results; comments carry no label and are sorted |
| Raw answers are kept for ever, or the kept result keeps a comment | the retention test: raw answers, responses and codes deleted at 24 months, the result kept without comments, the run audited, 0 months deletes nothing |
| A guesser finds a code | the limiter test; codes are 60 bits and single-use |
| Another company reads or answers anything | the tenant isolation test |
| The audit log says who took part | the audit test: no code, answer or comment in it, and no submission event at all |

## Assumptions (my recommended answers; change any of them)

Answers are unlinked (above). Five answers minimum; ten invited before a group is shown; breakdown by role and department only; the HR administrator alone runs surveys; no manager team results; 24 months retention; a closed survey is never reopened (results never change once read); online and code-based participation only (no paper forms); the QR code image itself is not generated (the address is shown for a QR generator or a poster).

Smaller choices you did not ask for: **the codes are tied to the employee only on the code row, as a participation marker**, and the sheet that maps a name to a code exists only on screen once; **a survey may be run for a group of any size**, as you decided (the plan's rule that a group under ten could not be surveyed was dropped); **the HR administrator reads the survey page (counts and results), the auditor the list**; **the public address works only while the survey is open**.

## What I did not do or test

- **A lawyer should review** the anonymity wording shown to employees, the retention, and whether anonymous survey data counts as personal data under the Nigerian rules.
- **A new unauthenticated entry point** is added (the survey address). It is gated by a single-use code and a limiter that is **in memory on one server** (put a limit at the proxy as well when hosted).
- **Not built:** paper forms, a QR image, notifications and reminders (a reminder would need to know who has not answered), per-person results, manager-level results, repeat scheduling.
- Browser checks are reported in the task report (what was seen on screen and what was not).
