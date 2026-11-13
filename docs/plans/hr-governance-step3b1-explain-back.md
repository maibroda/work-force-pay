# Explain-back note: governance step 3b-1, measuring what is due

For the founder. Plain language. Plan: `hr-governance-plan.md` section 2.4. **This changes nothing about what is kept or deleted, and it needs no migration.** It is the read-only half of step 3b; the half that removes things is in `hr-governance-step3b2-plan.md` and waits for your answers.

## What it does, in one line

For each kind of record, it counts what has reached the end of its retention period, what will within 90 days, and how many of those a legal hold protects, and it tells HR in the daily digest.

## What the code does, step by step

1. It reads the company's own rule for each category (how many months, counted from what). Where a company has none yet, it reads your proposed default, **without writing anything**.
2. **Former employees:** a person counts as past the period when their leaving date plus the period (whole months) is today or earlier. Only people who have left, and have not already been erased, are looked at. Of them, the person is counted **once** for a category if they still hold at least one record of that kind (two disciplinary records are one person).
3. **Welfare cases** are counted **per case from the day it was closed**, even for someone who still works here (your default is six years after the case closes). An open case is never counted.
4. **Succession entries** are counted per entry from the day it was last changed (the annual review). **Audit log entries** are counted by the day they were written. These two are for **review**; nothing is removed.
5. **The employee file, raw survey answers and unsuccessful applicants** still follow their HR-policy setting (years or months), because that is what actually governs when they run. The page shows that.
6. A **legal hold** is counted as covering a person, a category or the whole company exactly as it already stops a deletion (step 3a).
7. A rule that says "keep", or a period of nothing, shows as nothing due. A rule counted from a day the system cannot work out for that category is shown as **not measured, with the reason**; it is never guessed.
8. The digest line counts **kinds of record**, not people and not names.

## A worked example

Tunde's Security Co. uses your defaults (six years after leaving). Ada left seven years ago and holds a disciplinary record and some feedback; Bola left five years and ten months ago and holds a disciplinary record; Chidi still works there. Today the view shows disciplinary **1 person past** the period (Ada), **1 within 90 days** (Bola's six years end in about two months), feedback 1 past. If HR places a legal hold on Ada, disciplinary shows 1 past, **1 held**. Nobody is named anywhere, and the digest says "2 kind(s) of record have items past their retention period" (disciplinary and feedback), without saying which.

## What could go wrong, and which test proves it does not

| Risk | Test (`tests/integration/retention-due.test.ts`, `tests/unit/retention-schedule.test.ts`) |
| --- | --- |
| Someone is counted who should not be (still employed, left recently, nothing of that kind, already erased) | "does not count someone still employed ..." |
| The same person is counted twice | "counts ... once each" |
| The 90-day window is wrong at the edges | the unit test on exactly 90 and 91 days, and "separates what is past ..." |
| A shorter or longer period is ignored | "follows the rule as edited" |
| A trigger the system cannot work out is guessed | "does not guess when a rule names a trigger ..." |
| Another company's records are counted | "never counts another company's records" |
| A name, an id or a record's words leak | "carries no name, no id of a person and no record text"; the digest test for the retention section |
| Holds are not respected in the count | the two hold tests (person, category, company, welfare) |
| Month arithmetic at the end of a short month | the unit test (31 January plus one month is 28 February; leap years) |

## What I did not do, and what to know

- **Nothing is deleted or changed.** The retention run is 3b-2.
- **Audit log counts** are to the day except at the end of a short month (they are for review, not deletion).
- **Not measured:** the access logs (no account-closure date to count from), and the 90-day window for raw survey answers and unsuccessful applicants.
- The employee file's count follows the HR policy setting, not the schedule's number, until the two are joined (3b-2 question for the lawyer).
