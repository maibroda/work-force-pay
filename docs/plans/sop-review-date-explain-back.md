# Procedures (SOPs) must have a review date: explain-back note

Written 2026-11-17 for the founder's approval of 2026-11-17 ("approved as recommended") of the rule I proposed on making the review date mandatory for a procedure. **No money, pay or statutory setting is touched.** It tightens one rule in the policy area (slice 4B). One small additive migration (a company setting).

## What the code does, step by step

1. **A new procedure (SOP) needs a review date.** It must be **no later than 12 months after it takes effect**. If it takes effect in the future, the 12 months count from that day. A **handbook and a policy are not held to this**: their review date stays optional, however far off.
2. **12 months is a company setting**, "A procedure (SOP) must be reviewed within (months)", under the HR policy settings, from 1 to 60 (12 until the company changes it). Existing companies start at 12.
3. **Publishing a new version of a procedure** needs a review date on file that is within the window for the new wording, **or one given at the same time** (the "Publish version" form now has a "Review due on" box, which also changes the date on file). If there is none, or it is too far off, the version is **refused and nothing is published**.
4. **Marking a procedure reviewed** needs the **next review date**, no later than the company's months **from today** (a procedure that took effect long ago is counted from today, so a review always allows a full period ahead). Blank is refused for a procedure; a handbook can still be marked reviewed with no next date.
5. **A procedure's date can be changed but never cleared.** Editing a procedure's settings with the date blank is refused.
6. **Procedures made before this rule, with no date, are not blocked or changed.** They stay in the list, employees still read them, and nothing is acknowledged or lost. The list and the procedure's page say **"No review date set"**, and **the next edit must set one** (the edit is refused until a date inside the window is given).
7. **Plain messages on screen:** for example "A procedure (SOP) needs a review date, no later than 12 months after it takes effect." and "The review date can't be later than 2027-11-17 (12 months after the procedure takes effect)."

## Where each rule comes from

The founder's approval of 2026-11-17 of the proposal: a new procedure needs a review date no more than 12 months after it takes effect (a company setting); publishing a version or marking it reviewed also needs a next date within that window; existing procedures with no date are not blocked, shown as "no review date set", and the next edit must set one; handbooks and policies stay optional.

## Worked example

Today is **17 November 2026** and the company keeps the setting at 12 months. HR publishes the procedure **"Cash handling"** with no review date: it is **refused**. HR gives **1 June 2028**: refused, "can't be later than 2027-11-17". HR gives **1 June 2027**: **published**. After 1 June 2027 it appears in the HR digest as overdue (as in slice 4B). On **1 June 2027** HR reviews it and **marks it reviewed with the next review on 1 June 2028**: **accepted** (exactly 12 months from that day); **2 June 2028** would be **refused**, and so would leaving it blank. A procedure written last year **with no date** shows "No review date set"; the day HR corrects its wording, the edit is refused until a review date is given.

## What could go wrong, and what I did not do

- **A company that never edits an old procedure** keeps it undated. It is flagged on the list but **does not appear in the HR digest** (the digest lists only dates that have passed). Say if you want undated procedures in the digest too.
- **The window is measured from the wording's effective date, or from today if that is in the past.** A procedure published with a far-future effective date can therefore have a review date far in the future; that follows from "after it takes effect".
- **A review date in the past is still allowed when making a procedure** (only a date that is too far ahead is refused), as before.
- **Not built:** a reminder before the review date, a second person approving a review, and a report of undated procedures.
- **Not browser-checked** as finance, the auditor or a manager (the tests and CI's smoke test cover the roles; no new page was added).

## Tests that prove it (written first)

`tests/unit/policy-sop-review.test.ts` (4): the latest date from the effective day or from today, the company's months, and a short month. `tests/integration/policy-sop-review.test.ts` (15): the company setting (12 by default, 1 to 60, whole months); making a procedure (a date is needed, within the window, counted from a future effective date, following the company's months; a handbook and a policy unaffected); editing (an undated procedure is not blocked but its next edit must set a date inside the window, a dated one can be edited and never cleared, a handbook can still be cleared); publishing a version (refused with no date or too far off and nothing published, a date given with it is set, a valid date on file goes ahead, a handbook never needs one); marking reviewed (a next date is needed and within the window from today, counted from today for an old procedure, a handbook can have none). **Existing tests changed (on purpose, with dated comments):** in `policy-kinds.test.ts` the test helper now gives a procedure a review date unless a test says otherwise, one test that said a procedure's date "is optional" now says it for a handbook, and one step that cleared a procedure's date when marking it reviewed now sets a new date instead; every other behaviour tested there is unchanged. **Migration:** `20261222090000_sop_review_months`, reversible, round-tripped (up, down, up) on a copy of the seeded database: the 27 existing company policies got 12, the down script removed the column, and there was no schema difference. **Browser check (local demo company, synthetic data, removed afterwards):** a procedure made with no date was refused with the plain message; one with a date about 18 months out (1 June 2028) was refused naming the latest allowed day (17 November 2027); one with a date inside the window was published and showed "review due 01 Jun 2027"; the edit, publish-version and mark-reviewed forms showed the procedure wording; and the settings page showed the new field at 12.
