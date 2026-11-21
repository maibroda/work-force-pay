# Explain-back note: hourly pay, H14 piece 2, step 2a (recording and approving a spell of sickness)

Step 2a of piece 2 (paid sickness) of `hourly-payroll-h14-build-plan.md`, started on the founder's "CONTINUE" of 2026-11-21, on his answers of 2026-11-20 and 2026-11-21 (paid sick leave, 5 days a year, a medical certificate, HR approves, the same leave year and service period as annual leave). **Piece 2 is large, so I am doing it in three steps, each its own pull request: 2a (this one: recording, approval and the days of entitlement, no pay), 2b (the pay: average daily hours, usual days, the payslip line, the payroll findings), 2c (the screens).** **No pay changes in this step.** **One additive migration** (`20270101090000_sick_spells`, with `down.sql`, round-tripped down and up on a copy with no drift left). Files: `src/lib/sick-leave.ts` (new, pure), `src/server/services/sick-leave.ts` (new), `src/server/services/leave.ts` (one setting), the leave settings page.

## What it does, step by step

1. **A setting in the leave policy:** "Paid sick days a year (staff paid by the hour)", 0 to 60. **0, the default, means paid sick leave is not set up** and no spell can be recorded. You enter 5. It uses the same leave year and the same service period as annual leave.
2. **Recording a spell** (a person for themselves, or HR for anyone): the first and last day and the **medical certificate**, which must be a document of the employee's own in the **medical category** (the document store already restricts medical files to people with sensitive access). It is refused when: paid sick leave is not set up; the person is not **paid by the hour** on the first day; they have **not yet completed the service period** (it says when it falls due); the dates have **no working day**; the certificate is missing, someone else's, or not medical; it **overlaps** another waiting or approved spell; or it falls in a **closed** pay period (an approved, locked or paid period is fine: it will be paid by a supplementary payroll, as late hours are).
3. **A spell holds only dates, working days, the leave year it is charged to and the certificate's id: never a diagnosis or any health detail.** It is charged to the leave year that contains its **first day**, whenever it is recorded. The audit log holds ids and numbers only; the words of a rejection stay on the spell and never go to the audit log.
4. **HR approves or rejects, and never the person who recorded the spell, nor the person it is about.** A rejection needs a reason. A decision is final.
5. **Cancelling:** while a spell waits, by whoever recorded it or by HR; once approved it can no longer be cancelled here.
6. **The days:** a balance for each person and leave year: entitled, approved, waiting, left. **A spell beyond the entitlement is recorded, not refused** (sickness is not optional); the days beyond it will simply not be paid in step 2b.
7. **Who sees what:** HR sees every spell of the company; a person sees their own; nobody else does (a supervisor does not see sickness). Everything is scoped to the caller's company.

## Where each rule comes from

Your answers of 2026-11-20 and 2026-11-21 and the build plan's question 8 (HR approves and not the recorder; the certificate is a medical document; the leave record holds dates and days, never a diagnosis). The service period and the leave year are the existing leave policy, so paid sick leave before 12 months' service is not due (as annual leave): **this is my reading of "eligibility: the same as monthly staff", please confirm it applies to sickness too.**

## Worked example

A guard paid by the hour since 2030 is ill from Monday 1 June to Friday 5 June 2043. They (or HR) record it with their medical certificate, 5 working days, charged to the leave year that began on 1 January 2043. A different HR user approves it. The guard's balance for that year shows 5 days entitled, 5 approved, 0 left. If they are ill again later in the year, that spell is recorded and approved the same way, but its days are beyond the entitlement and will not be paid.

## What could go wrong, and what is NOT covered

- **No pay yet.** Approving a spell pays nothing until step 2b, which also decides which days are paid (up to 5, in date order) and how much (average daily hours at the weekday rate).
- **No screens yet** (step 2c): the service is ready for them; until then spells can only be recorded through the service.
- **A spell that crosses the end of a leave year is charged entirely to the leave year of its first day.**
- **An approved spell cannot be cancelled** in this step. If a sick day has been approved wrongly, tell me: the correction (and a spell already paid) is part of 2b.
- **The certificate type:** any document in the medical category counts. I suggest adding a standard "Sickness certificate" document type; it is data, not code.
- **A person's service period is counted from the employment date**, as for annual leave.

## Tests that prove it

`tests/unit/sick-leave.test.ts` (8): the leave year a spell is charged to (first day; before the service period none; the leave policy's period), the balance counting approved and waiting days only and never below zero. `tests/integration/sick-spell.test.ts` (11), an isolated company: the setting (0 refuses, validated, set); a recorded spell is kept as dates and ids only and the audit entry has no health words; refused for a monthly person, a person not yet in the service period, another company's person, no working day and a reversed range; the certificate rules; overlap and closed period; a person records only their own; approval by someone else, a reason for a rejection, finality, and the words staying out of the audit log; another company cannot decide, cancel, list or count it; cancelling; the days of entitlement with a spell beyond it recorded; who sees which spells.
