# CRM Phase 8 plan: reports and dashboards

**Status: built on branch `feature/crm-phase-8` after the founder's "continue" (2026-10-30). It is entirely read-only: no migration, no new table, no change to payroll, billing or any record.** The definitions below are mine, listed for you to confirm.

## What the pack asks for, and what is built
Three dashboards (Sales, Accounts, Service) at `/sales/reports`. **Every widget has a date filter, a drill-down to the records behind each figure, and a CSV export.** **Every figure respects the viewer's permissions**: a salesperson sees only their own deals, accounts and cases; Operations and managers see everyone's; another organization's data is never counted. The same figures are produced by pure functions that the tests check against a fixed synthetic dataset with hand-calculated answers.

| Widget | What it shows | The date filter applies to |
| --- | --- | --- |
| Open pipeline | open deals by stage: count, monthly value, weighted value | when the deal was made |
| Forecast | weighted value by expected close month | expected close date |
| Win rate | won / (won + lost), overall and by month, owner, source and service | when it was won or lost |
| Sales cycle | average, fastest and slowest days from made to won | when it was won |
| Time in each stage | average days a deal stayed in a stage before leaving it | when it left |
| Stage-to-stage conversion | of the deals that reached a stage, how many later advanced | when the deal was made |
| Lost reasons | why deals were lost, with shares | when it was lost |
| Competitors | wins and losses against each competitor named | when it closed |
| Activity by person and week | calls, meetings and site surveys | when it happened |
| Source to revenue | monthly value won by lead source | when it was won |
| Quote margins | quotes by margin band, and how many below the minimum were approved | when the quote was made |
| Accounts by health | accounts by band; at-risk accounts with their main reason | current (snapshot) |
| Renewals due | contracts ending in 30, 60 and 90 days and the state of each renewal | current (from today) |
| Rate reviews | **not available: rate reviews are not built (waiting for your decision, see 07b)** | n/a |
| Revenue concentration | share of total won monthly value held by the top 5 and top 10 clients | when it was won |
| Cases opened and closed | by category | opened, or resolved |
| SLA compliance | first-response and resolution, as a percent of the deadlines that have fallen due | when the case was opened |
| Breaches | missed deadlines by account and by site | when the case was opened |
| Reopen rate | cases reopened / cases ever resolved | when the case was opened |

## Definitions I chose (please confirm or correct)
1. **Win rate** counts only closed deals: won / (won + lost); no closed deals shows a dash, not 0%.
2. **Conversion** is "of the deals that reached this stage, the share that later moved to a later open stage or to won" (losing is not progress, and a deal that skips a stage still counts as advancing).
3. **Sales cycle** is the whole days from the deal being made to being won; the average is to one decimal.
4. **Revenue concentration uses the monthly value of won new-business deals** (renewal deals are left out so a renewal does not count a client twice).
5. **SLA compliance** counts a deadline only once it has fallen due or been met: a case still inside its window is neither met nor missed. A case with no SLA policy is not counted.
6. **A breach** is a case whose first response or resolution was missed or late (counted once per case). **Reopen rate** is the cases reopened at least once over the cases ever resolved.
7. **Weeks** run Monday to Sunday in Lagos time.
8. **Quote margin bands:** below 0%, 0 to under 5%, 5 to under 10%, 10 to under 15%, 15 to under 20%, 20% and over; the "below the minimum" count uses the minimum in force when each quote was sent.
9. **Money is added in whole kobo**, never as a floating-point number.
10. The drill-down lists up to 200 records for each figure; the CSV carries every figure, and, with `records=1`, the underlying records (up to 5,000).

## Tests first
Pure aggregation tests against one fixed synthetic dataset, each answer worked out by hand and written beside the test (for example: win rate 3 of 6 is 50.0%, Ada 2 of 3 is 66.7%, the sales cycle 40, 30 and 30 days averages 33.3; a call at 00:30 on Monday in Lagos belongs to the new week and one at 23:30 on Sunday to the old). Then on real data: a salesperson sees only their own, a manager and Operations see all, another organization is excluded, the date filter, drill-down ids, CSV content (including a spreadsheet-formula cell being neutralised), and that the dashboards write nothing.
