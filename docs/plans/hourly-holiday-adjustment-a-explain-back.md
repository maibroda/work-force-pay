# Explain-back note: the late-holiday adjustment, piece A (the record and its review; no pay yet)

Piece A of `hourly-holiday-adjustment-plan.md`, on the founder's "go with A" and his decisions of 2026-11-21 (a public-holiday shift approved after payroll paid the day as not worked is corrected through the next open payroll, the net difference only, with supervisor approval and payroll review, no duplicates, a full audit trail). **Piece A changes NO pay: it records what would have to be corrected and gets it reviewed. Applying it in the next open payroll (B), recovering an overpayment within the cap (C) and leaving the late shift out of the supplementary payroll's own pay (D) are later pieces, each its own pull request.** I used the plan's default answers to its questions; correct any of them before the next piece.

## What it does, step by step

1. **A holiday adjustment is proposed automatically** when a shift is approved on a public holiday **that a payroll with a final period (approved, locked, paid or closed) already paid as "holiday not worked"** to that person. One adjustment for each person and holiday: a **unique key** makes a second one impossible. If the original period is still open nothing is proposed, because recalculating it already leaves the day out of the not-worked pay.
2. **What it stores:** the person and the holiday date; **the shift** (the approved time entry) and **who approved it and when** (that is the documented supervisor approval); **the original payroll run and the stored line** that paid the day, what it paid, and how it was classified ("holiday not worked"); **the corrected entitlement** (the person's approved hours that day at the approved **holiday rate**, as any worked holiday is paid); and the **net difference** (corrected less paid, which can be positive, zero or negative). Whole kobo, rounded half up once. If there is no approved holiday rate the figures stay empty and it cannot be approved until there is one.
3. **A second shift the same day** is added to the one waiting (the figures are worked again from all of that day's approved holiday hours); an adjustment already reviewed is left as it is.
4. **The review:** a person with the payroll approval right approves or rejects it. **Never the person who approved the shift, never the person it is about**; a rejection needs a reason (kept on the record, **never in the audit log**); the decision is **final**. The figures are worked again at the moment of the decision so what is decided on is current.
5. **Audit:** every step is an audit entry (proposed, updated, approved, rejected) holding ids and numbers only, no names and no reasons.
6. **The screen:** on the Public holidays page, a "Holiday adjustments" section lists them with the person, the holiday, what was paid, the corrected entitlement, the net difference, who approved the shift and the status; reviewers see Approve and Reject buttons (not for the shift's approver or the person themselves). It says plainly that this changes no pay yet.
7. **The original payroll and its stored lines are never touched.** A test proves the closed payroll's record and its holiday line are unchanged after the adjustment is proposed and after it is approved.

## Where each rule comes from

The founder's brief (the late-approved public-holiday shift) and his answers of 2026-11-21 recorded in the plan: the shift approval is the supervisor approval; the corrected entitlement is the hours worked at the holiday rate; a second person reviews.

## Worked example (invented figures)

A guard's usual days are Monday to Thursday, 8 hours, weekday rate 1,000, holiday rate 2,000. Monday 6 March is a Lagos holiday and no shift was recorded, so March's payroll paid **8,000.00** as a holiday not worked, and March is locked. Later their supervisor's shift for that Monday (8 hours) is approved. An adjustment is proposed: paid **8,000.00**, corrected entitlement **16,000.00**, net difference **+8,000.00**. A payroll reviewer who did not approve the shift approves it. **Nothing about March's payroll changes.**

## What could go wrong

- The adjustment records the net difference but **does nothing with it yet**: until piece B the supplementary payroll still pays the late shift in full and #268's finding still raises the alert (piece D removes that double step).
- A reviewer must exist who is neither the shift's approver nor the person (in a very small team that can be a limit).
- A shift approved before the payroll was final, or on a holiday not paid as not worked, is not covered (nothing to correct).

## Which tests prove it

`tests/integration/holiday-adjustment.test.ts` (6): proposed with the links, the original line, the corrected entitlement and the net difference, and the closed payroll untouched, audited with ids only; not made for another day or an unpaid holiday; never twice (a second shift is added, the key is unique); approved by a reviewer who is neither the shift's approver nor the person, with no payroll right refused, final, no pay changed; a rejection needs a reason kept off the audit log; another company cannot list or review it. The existing time-entry and entitlement entry-point tests still pass.

## Migration and rollback

`20270109090000_holiday_adjustment`: one new table and one status type. `down.sql` drops them (the adjustments are then lost; the audit log keeps their ids and numbers); round-tripped on a throwaway database. No existing table is changed.

## Legal and policy dependencies

Piece A recovers nothing and pays nothing. **Piece C (recovery of an overpayment from pay) must not be switched on in production before the legal and payroll-tax review of deductions from wages is recorded** (the plan's question 7).
