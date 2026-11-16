# Survey hardening: explain-back note (decisions S1 and S2)

Written 2026-11-16 for the founder's approval of 2026-11-16 ("survey hardening S1 + S2"), from the review of 2026-11-14. **No money, pay, statutory setting or bank file is touched.** This changes what an answer carries when it is stored, and who may read the words of a comment.

## What the code does, step by step

1. **When someone answers (S1).** The system already stored an answer with no name, no user and no time. It also stored the person's **role and department** on the answer, so that results could be broken down by role. Now it first counts **how many different people were invited in that role** (and, separately, in that department) for this survey. **If ten or more were invited, the role is stored; if fewer, nothing is stored for it.** The same is done for the department. The person's access-code row is **not** changed: it still holds their role and department, because the "how many were invited" counts come from it.
2. **When HR reads the results (S1).** A role or department with ten or more invited is counted exactly as before. All the **smaller** ones are counted together, because their answers no longer say which small group they came from. The rule "if exactly one group is hidden, hide the next-smallest too, so it cannot be found by subtraction" still counts the small groups one by one, so it gives the same result as before.
3. **Who reads the words of a comment (S2).** The results page now gives the comments' words only to someone who holds the Surveys right (the HR administrator, or a delegated HR officer with the Surveys function), the same people who can **hide** a comment. The auditor, finance, the company administrator and the super administrator still see the **figures**, and are told that the words are for the HR administrator.

## Where each rule comes from

The founder's approved rule of 2026-11-14: individual responses must not be identifiable through the application or by someone reading the tables, "no leak through comments, metadata or small groups". The ten-invited figure is the existing rule for showing a group on its own (`MIN_INVITED_FOR_GROUP`); S1 only stops storing a label that would never have been shown.

## Worked example

A survey invites **13 guards, 12 office staff and 2 supervisors**; all answer. Before: every answer carried its role, so a person reading the tables could see that exactly two answers belonged to the supervisor grade, and with the access-code rows could tie them to the two supervisors. Now: the 13 guards' and 12 office answers carry their role; **the two supervisors' answers carry none**. The page is unchanged: guards shown; the office group is hidden together with the two supervisors (so the supervisors cannot be found by subtraction); "other roles combined" shows 14 invited and 14 answers.

## What could go wrong

- **Answers stored before this change** still carry a small group's label. They are counted correctly (in the combined row) but remain linkable by someone reading the tables. **They are not rewritten** (no backfill: it would change stored data, and the founder asked for new answers only). If you want old rows cleared, it is a separate, approved, backed-up data change.
- **People with no role set** are counted with the small groups. Before, ten or more such people could have shown as "No group". This is stricter, not looser.
- **A person reading the database, backups or statement logs** can still correlate rows by other means. This change removes one link; it cannot remove them all.
- The auditor, finance and the administrators can no longer read comment words. That is the intent; say if the auditor should keep access.

## Tests that prove it (written first; five failed without the code)

`tests/integration/survey-hardening.test.ts` (9): ten invited stores the role, nine stores none; role and department are decided separately; the access-code rows are unchanged; the combined row counts every hidden answer, with the worked example's numbers; answers stored the old way are counted the same; a survey where every group is small comes out as before; HR sees comment words; the auditor, finance, company administrator and super administrator get figures only; after the raw answers are deleted no comment is kept. The existing survey, anonymity and unit tests pass unchanged.

## A finding, reported and not fixed (it existed before this change)

**Two hidden small groups can be found by subtraction.** The rule that hides the next-smallest group applies only when **exactly one** group is hidden. If **two or more** small groups are hidden and their combined row is itself too small to show, the whole-survey figure minus the shown group's figure gives the combined hidden answers exactly.

**Example (checked by running the real function):** group A has 30 invited and 20 answers, B has 3 invited and 2 answers, C has 4 invited and 2 answers. The page shows A, and "other: not shown". The whole survey is 24 answers (twenty 4s, two 1s, two 2s); A is twenty 4s; so the hidden four people's ratings are exactly two 1s and two 2s.

**Severity: medium.** It reveals the ratings of fewer than five people as a set, not who gave which; it is reachable through the application.

**Proposed fix (needs your approval):** when the combined hidden row is not itself shown, hide the smallest shown group too, repeating until the remainder is large enough or no group is shown. I have not changed this.
