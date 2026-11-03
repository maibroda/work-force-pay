# CRM Phase 7b plan: the account health score (rate reviews are held for a decision)

**Status: the health score is built on branch `feature/crm-phase-7b` after the founder's "continue" (2026-10-30). Rate reviews are NOT built: they depend on a rule only you can set, explained below (a `CLAUDE.md` stop condition).** The weights and the formulas below are my starting choices, listed for you to confirm; the weights are editable.

## The account health score (built)
A score from 0 to 100 for each **client account** (an account linked to a real client), recomputed every night and when a case on it changes, shown on the account page with the **breakdown of what produced it**, and on a Health page that lists the weakest accounts first. **Bands as the pack gives them: 70 to 100 healthy, 40 to 69 watch, 0 to 39 at risk.** An account that is at risk gets **one** task for its owner ("Account at risk: ..."), not a new one each night while an open one exists.

It is **read-only on payroll, attendance and billing**: it only reads attendance and invoices, through the same open-invoice function the receivables screens use.

| Component (from the pack) | What is measured | Starting weight | Sub-score, 100 is best |
| --- | --- | --- | --- |
| SLA breaches, last 90 days | Missed first-response or resolution deadlines | 20 | 100 minus 25 for each |
| Open critical and high cases | Cases not yet resolved | 15 | 100 minus 40 for each critical, 25 for each high |
| Guard absence on the client's sites | Absent days as a share of days a guard was expected (present, late, absent), last 30 days | 20 | 100 minus 5 for each percent absent |
| Invoice days overdue | Days past due of the oldest unpaid invoice | 20 | 100 if none overdue, falling to 0 at 60 days |
| Contract end with no renewal in progress | Days to the end of the next active contract ending within 90 days | 10 | 100 if none, or a renewal is in progress; else 100 x days left / 90 |
| Days since client-facing activity | Last call, meeting, site survey, WhatsApp or email (not notes) | 15 | 100 up to 30 days, falling to 0 at 120 |

The score is the weighted average of the sub-scores, **rounded half up to a whole number**. **A component with no data (for example no attendance records for the client) is left out and the other weights are scaled up to fill its place**, so a missing feed never makes an account look sick or well; the breakdown says so.

## Choices I made (please confirm or correct)
1. **The weights and sub-score formulas above are mine** (the pack names the six components but gives no numbers). An administrator can change the weights (they must add up to 100); the formulas are fixed until you give different ones.
2. **"Client account" means one linked to a real client**, because attendance and invoices belong to the client. Prospects are not scored.
3. **Absence ignores leave, days off and suspension** (planned, not absence).
4. **Client-facing activity excludes notes** (a private note is not contact with the client).
5. **"Renewal in progress" means a renewal deal has been opened for the contract and has not been lost.**
6. **An at-risk account gets a task for its owner**; a manager is not separately told.

## Rate reviews (NOT built: needs your decision)
The pack: when an effective-dated cost setting changes, recompute the cost per head of each active contract's rate card, and where the margin falls below the threshold open a "Rate review" deal showing old margin, new margin, and **the bill rate needed to restore the target margin**.

**The problem:** in this app the guard's pay is a **share of the bill rate** (70% by default). So when the bill rate goes up, the guard's pay and the employer's percentage costs go up with it, and, **for a pay structure made of percentages (as the standard one is), the margin percentage does not change at all**: it depends on the share and the employer-cost percentages, not on the price (the quote builder shows this: about 9% at a 70% share, whatever the bill). A structure with fixed naira components would behave differently. So no bill rate "restores" a margin that a new employer cost percentage has eroded; only a **lower guard share**, or a change to what the client is billed **on top of the pay** (so the pay stays the same in naira), would.

**Which of these is true of your contracts?**
- **(A) The guard's pay is a fixed naira amount set by the pay structure**, and the agreed rate is what the client is charged. Then a rate review should hold the pay (and the cost percentages on it) fixed and solve for the bill rate that restores the margin.
- **(B) The guard's pay is always a share of the agreed rate.** Then a rate review can only propose a **new share** (and a smaller guard share is a pay cut, which is a decision for you and the contract), so it would show the margin falling and the share that would restore it.
- **(C) Something else** (for example a minimum-wage floor that lifts the pay whatever the share).

Tell me which, and which margin counts as "the target" (I assume the same minimum margin the quotes use), and I will build it. It would only ever propose; it would never change a rate or touch payroll.

## What the health score adds
Table `CrmAccountHealth` (the latest score and its breakdown, and when the band last changed); a column `healthWeights` on the sales setting. Migration `20261110090000_sales_health`, reversible. A nightly job `/api/cron/sales-health`, off until `CRON_SECRET` is set.

## Tests first
Each component's sub-score and the score on hand-worked accounts (all 50, one component at zero, an at-risk account, the half-up rounding, a missing component scaling the others, the band edges at 70, 69, 40 and 39, the weights check); then on real data: cases and breaches, absence from the attendance register, overdue invoices from the billing fixture (paid ones and not-yet-due ones do not count), a contract ending with and without a renewal, the last client-facing activity, the task for an at-risk account made once, the band change recorded, organization isolation and permissions.
