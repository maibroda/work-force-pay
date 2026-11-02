# CRM Phase 7a plan: cases, SLAs and renewals

**Status: built on branch `feature/crm-phase-7a` after the founder's "continue" (2026-10-30). Phase 7 is split, as phases 1, 3 and 5 were: 7a is cases, SLAs and renewals; 7b (rate reviews and the account health score) comes next, because it reads payroll cost, attendance and billing and deserves its own plan.** The choices below are mine, listed for you to confirm.

## What the pack asks for, and what 7a builds
1. **Cases** on an account (optionally a contact, a deal and a site), with a category and priority, opened by a salesperson or by Operations. Responses and status changes are kept as a history and shown on the account and contact timelines.
2. **SLA policies:** for a priority, the time to first response and to resolution, and whether the clock runs only in business hours. A policy for that account wins; otherwise the organization's default for that priority applies. The due times are worked out when the case is opened and **kept on the case**, so a later change to a policy never moves a case's deadline.
3. **Business hours and holidays** an administrator can edit (working days, opening and closing time in Lagos time, and a list of holidays). **I have not entered any public-holiday dates: they differ by year and are announced by government, so they are yours to add.**
4. **Warnings at 75% of each window, breach flags once passed, and an escalation to the sales managers on a breach** (in the app and by email), carried out by a scheduled job (`/api/cron/sales-cases`, off until `CRON_SECRET` is set). A breach is also shown the moment a due time has passed, without waiting for the job.
5. **Reopening:** a reopened case restarts its resolution clock (first response is not asked again), counts in `reopened` and is shown separately.
6. **Renewals:** a daily job finds active contracts ending within a window (90 days to start, editable) and opens **one** Renewal deal for each (the database allows one per contract), with the current monthly value from the deal that won the contract, the account's contacts, the contract's end date as the expected close, and the account's owner as owner. It tells the owner.

## Choices I made (please confirm or correct)
1. **Business hours start as Monday to Friday, 08:00 to 17:00 Lagos time** until you change them. A window of 60 business minutes asked for at 16:30 on Friday ends at 08:30 on Monday.
2. **The starting SLA figures are placeholders, in business hours except critical:** critical 1 hour to respond and 4 hours to resolve, around the clock; high 4 hours and 1 working day; normal 1 working day and 3 working days; low 3 working days and 10 working days. **Please give me your real figures.** (Policies are not made until an administrator asks for the starting set.)
3. **"Manager" means the people who can see and change everyone's sales records** (the app has no reporting lines), as in Phase 6.
4. **A new permission, `sales.case.manage`, goes to Operations, sales people and the company administrator**, so Operations can open and answer cases; Operations still cannot change deals.
5. **A deal's "current monthly value" for a renewal is taken from the deal that won the contract** (through its handover). A contract that did not come from a handover has no such figure: its renewal deal is opened at zero and says so.
6. **A case has two statuses, open and resolved**; reopening makes it open again. (No "waiting on client" pause, which would be a way to stop an SLA clock; add it only if you want it.)
7. **A case has no SLA if no policy applies**, and says so, rather than being refused.

## What it adds
Tables `CrmCase`, `CrmCaseEvent` (history the database refuses to change), `CrmSlaPolicy`, `CrmBusinessHours`, `CrmHoliday`, `CrmRenewalLink`; a column `renewalWindowDays` on the sales setting; enums for category, priority and status. No payroll, billing or operations table changes. Migration `20261109090000_sales_cases`, reversible.

## Tests first
Business-time arithmetic (within a day, across a close, over a weekend, over a holiday, starting outside hours, exactly at close, whole days, around the clock); policy resolution (account over default, none); due times kept when a policy changes; 75% warning and breach timing; escalation; reopening restarts the resolution clock and counts; the timeline shows case events; renewal idempotency, window and pre-fill; permissions and organization isolation; audit without text.
