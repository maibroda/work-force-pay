# Release notes

What changed, in the order it was merged, in plain words. Each entry names the pull request and the database migration (if any). **Nothing has been deployed yet**: no host has been chosen, so "released" here means merged into `main`. The most recent work is at the top.

## Not yet merged (branch `exact-money-3a`)

- **Exact money arithmetic, stage 3a of 5: the pieces under the engine** (rule 2). A new exact-fraction type (`src/lib/exact-fraction.ts`) holds amounts that are not yet rounded, so that nothing is lost between steps. Salary-component formulas are now worked in exact fractions: `0.1 + 0.2` is `0.3`, and `ROUND()` in a formula rounds half up to the kobo (**a negative value at exactly half now goes away from zero: -0.125 becomes -0.13, it was -0.12**). Salary components are worked as exact fractions (`computeComponentsExact`; `computeComponents` keeps its numbers-in, numbers-out shape), and the **70:30 split now rounds half up**: an agreed rate of ₦50,002.45 at 70% gives the operative ₦35,001.72 (it was ₦35,001.71), about 1 agreed rate in 220 at 70%. **The payroll engine itself is unchanged in this step**: on 30,000 synthetic employee-months (2.27 million figures) and on the 352 seeded payroll records, the old and new engines give identical figures. A characterization test now records what the engine produces (300 synthetic scenarios, 22,646 figures) and fails if any figure changes without being listed and explained. The engine is about twice as slow per employee (3,000 employees in 1.9 s against 0.9 s). No migration.

## Merged

| PR | What | Migration |
| --- | --- | --- |
| #68 | Plan for exact money, stage 3 (document only). | none |
| #67 | **Exact money arithmetic, stage 2**: PAYE and the employee year-to-date pension in whole kobo. A month's PAYE can be ₦0.01 higher where the exact tax ends in half a kobo (about 1 in 290 synthetic months; 1 of 352 seeded records). | none |
| #66 | Plan for exact money, stage 2 (document only). | none |
| #65 | **Exact money arithmetic, stage 1**: `src/lib/money-exact.ts` and 39 tests, not yet used by the engine. | none |
| #64 | **Payroll Health Check** (spec 3.11): a 25-control checklist answered with evidence, a findings log, review by a second person, frozen on issue, one-page summary PDF. Also the project rules (`CLAUDE.md`), `docs/rules-conformity.md`, the generated data dictionary (a test fails if it is stale) and this file. | `20261104090000_health_check` |
| #63 | **Pricing and proposals** (spec 3.10): a rate card the founder must confirm, a delivery-cost calculator that gives the margin and the lowest fee that earns the target, proposals that attach to a lead, approval for a price below the target margin, sent proposals frozen, a PDF with no cost figures. Prices are placeholders until confirmed. | `20261103090000_pricing_proposals` |
| #62 | **Sales CRM and pipeline** (spec 3.9) and a Business Development role that sees the CRM and nothing else: leads and stages, outreach log with the daily target, referral partners and commission, dashboard. | `20261102090000_sales_crm` |
| #61 | **Launch checklist** for the bureau (rate tables verified, email, secrets, scheduler heartbeat, staff two-factor, client terms, and manual confirmations) and heartbeats on every scheduled job. | `20261101090000_launch_readiness` |
| #60 | Corrected the demo founder's name. | none |
| #59 | **Client portal, part 3**: clients send monthly inputs (overtime, allowances, bonuses, deductions) as a checked CSV that the bureau accepts or sends back. | `20261031090000_client_inputs` |
| #58 | **Two-factor compulsory for all bureau staff** (14 days' notice, only brought forward); a **record of who looked at sensitive details**; the **audit log made append-only** at the database. A design for field encryption was written but not built. | `20261030090000_bureau_staff_two_factor`, `20261030100000_audit_log_append_only` |
| #57 | Client portal, part 2: queries with response times, downloads, employee changes. | `20261029090000_client_queries` |
| #56 | Client portal, part 1: client roles, invitations, the client's approval of each payroll. | `20261028090000_client_portal` |
| #55 | Payslip PDFs, with download and optional email delivery. | `20261027090000_payslip_delivery` |
| #54 | ThreeRoots demo client (30 employees, 3 sites, one full month) and the acceptance checks. | none |
| #53 | Excel bank payment file. | `20261026090000_bank_payment_file` |
| #52 | Payroll deadline reminders by email. | `20261025090000_payroll_reminders` |
| #51 | Payroll calendar and input tracker. | `20261024090000_payroll_calendar` |
| #50 | Statutory rule library: HR and Finance verify a rate change before it reaches clients. | `20261023090000_rule_library` |
| #49 | Payroll bureau foundation: each client its own organization, staff access, engagement terms. | `20261022090000_bureau_foundation` |
| #48 | Employee CSV import with row-by-row checks. | `20261021090000_employee_import` |
| #47 | Payroll controls: the preparer can't approve, variance explanations, reconciliation sign-off. | `20261020090000_payroll_controls` |
| #46 | Year-end close. | `20261018090000_year_end_close` |
| #45 | Goods receipts and three-way match for purchasing. | `20261019090000_goods_receipt_three_way_match` |

## Known gaps

See `docs/rules-conformity.md` for the full list against the project rules, and `docs/threeroots-gap-analysis.md` for the product gaps. The largest: money is calculated in floating-point numbers, statutory rules have no "verified" gate on a payroll run, there are no golden tests or feature flags, field encryption is unbuilt, and migrations can't be reversed.
