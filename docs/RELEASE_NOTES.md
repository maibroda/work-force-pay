# Release notes

What changed, in the order it was merged, in plain words. Each entry names the pull request and the database migration (if any). **Nothing has been deployed yet**: no host has been chosen, so "released" here means merged into `main`. The most recent work is at the top.

## Not yet merged (branch `health-check`)

- **Payroll Health Check** (spec 3.11). A 25-control checklist across five areas, answered with evidence, a findings log with severity and recommendations, review and issue by a second person, then frozen; a one-page summary PDF with the "limited review, not an audit or certification" disclaimer. Migration `20261104090000_health_check`.
- **Project rules** (`CLAUDE.md`) and how the repository stands against them (`docs/rules-conformity.md`).
- **Data dictionary** (`docs/data-dictionary.md`), generated from the schema, with a test that fails if it falls out of date.
- **This file.**

## Merged

| PR | What | Migration |
| --- | --- | --- |
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
