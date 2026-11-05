# Explain-back note: a personal monthly gross is proposed by HR and approved by a payroll manager

Branch `pay-rate-approval`. One new table (`PayRateProposal`) and its migration `20261122090000_pay_rate_proposals`, one new permission (`payrate.approve`). **The payroll calculation is not changed.** This is an approvals and access-control change on pay data, so it needs your review.

## The rule you set (2026-11-05)

A personal monthly gross (for staff not paid from a client contract rate, for example office staff) is **proposed** by HR or payroll, and **approved by a payroll manager, a second person, before it counts**. The amount is the **monthly** gross. A personal gross still **takes precedence** over a contract rate (unchanged).

## What the code does, step by step

1. **Propose.** HR (or the payroll role) enters the monthly gross, an optional salary structure, an effective date and a reason on the employee's Salary tab. The server checks: the amount is a positive naira amount with at most two decimals (kept as exact text, never a float); the date exists; the structure, if named, exists and is active in this company; the employee is a current employee of this company; there is not already a pending proposal for them. It saves a **proposal**. **A proposal is not a pay rate**: the pay run reads only the pay-rate table, so nothing changes in any payroll until approval.
2. **Approve.** Only someone holding the new `payrate.approve` permission (the payroll role, the company administrator and the platform administrator; **not** HR, finance, auditors or employees) can approve. The server refuses if the approver is the person who proposed it, or if the pay is the approver's own. Approval creates the pay rate through the **same code as before** (it closes the previous open rate the day before and writes the new one with its effective date), records **the approver's own name** as "approved by" (the old form let the person type any name), and marks the proposal approved, all in **one step**: if the rate cannot be made (for instance a rate already starts on or after that date) nothing changes and the proposal stays pending.
3. **Reject or withdraw.** An approver can reject with a reason; the proposer can withdraw their own pending proposal. A decided proposal cannot be decided again.
4. **No way round it.** The server action that used to add a pay rate directly is removed; the employee's form now proposes. A test fails if any server action sets a pay rate directly.
5. **Audit.** Proposed, approved, rejected and withdrawn are each logged with the proposal's id, the employee's id and the names of the fields (never the amount). Approval also writes the existing "pay rate change" audit entry, as it always did.
6. **Each company sees only its own.** Another company's proposal is reported as "not found" for every action.

## A worked example

HR proposes ₦250,000.50 a month for an office employee, effective 1 November 2026, structure OFFICE. The employee had ₦200,000 from 1 January. Nothing changes in the October or November pay run. The payroll manager approves. The ₦200,000 rate now ends on 31 October 2026 and a ₦250,000.50 rate starts on 1 November, approved by the payroll manager's name. HR cannot approve it, the payroll manager who proposed one could not approve their own, and nobody can approve their own pay.

## What could go wrong, and what proves it does not (`tests/integration/pay-rate-approval.test.ts`, `tests/unit/pay-rate-amount.test.ts`, `tests/unit/rates-pay-rate-precedence.test.ts`)

| Risk | Test |
| --- | --- |
| Someone who should not propose or approve does | "who may propose and who may approve" (every other role refused) |
| A person approves their own proposal or their own pay | "cannot approve their own proposal… nor a rate for themselves" |
| A proposal reaches payroll before approval | "a proposal is not a pay rate"; the rate-book test refuses to read any proposal table |
| A float rounds the amount | the amount tests: 1000.555, 1e6, 12,000, 0.1+0.2 all refused; 1234.56 and 250000.50 stored exactly |
| An approval half-applies | "stays pending… if the approval cannot be applied" |
| Another company touches it | "another company cannot see, approve, reject or withdraw" |
| The amount leaks into the audit log | "is audited by ids and the names of the fields, not the amount" |
| A direct route survives | "no server action sets a pay rate directly any more" |
| A contract rate beats a personal gross | the precedence tests: personal gross wins; dates respected; no personal gross means the contract rate |

## What I did not do or test

- **Not built yet (the next pull request):** entering the gross when adding an employee and in the bulk import (they will create proposals, not rates). Until then the only way to enter one is the employee's Salary tab.
- Questions 3, 5 and 6 are **still open and not built**: the percentages for an office structure (needs your adviser), paid days (calendar days as today), and unpaid leave.
- Existing pay rates are untouched. The service function that makes a pay rate is still called by test fixtures and by approval only.
- Payroll staff who are not HR cannot approve their own proposals, so a one-person payroll office needs a second person with `payrate.approve` (the company administrator has it). Say if finance should also hold it.
- I have not checked the screens in a browser yet.
