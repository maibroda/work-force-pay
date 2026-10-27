# Release notes

What changed, in the order it was merged, in plain words. Each entry names the pull request and the database migration (if any). **Nothing has been deployed yet**: no host has been chosen, so "released" here means merged into `main`. The most recent work is at the top.

## Not yet merged (branch `verified-settings-gate`)

- **Payroll is blocked while a required statutory rule is unverified** (rule 3). For a **production client** (a client of the bureau whose engagement is **ACTIVE**), the PAYE, pension and employer-contribution rules in force for the period must each be exactly what **HR and Finance both signed** in the bureau's Statutory Rule Library, or the payroll is stopped. The check is made when a payroll is calculated, when a supplementary payroll is created, and when a payroll is **submitted, approved and locked**, so a rule changed after the calculation cannot slip through. It checks the rule's content against what was signed, so a rate changed directly in the database after sign-off is caught; how the rule reached the client (published, or copied when it was onboarded) does not matter. A rule the bureau is paying on that was **never put through the library** (a "baseline") counts as unverified, which matches the launch checklist. **There is no override**: the message names the rule and says to verify it in the library. **Every block is written to the audit log** (who tried, which step, which rule, why). Clients still being onboarded, the bureau's own organization and organizations that are not bureau clients are not stopped, but the payroll page now tells a person plainly which rules are not yet verified, and, when all are, who verified them and when. **No pay figure changes** (all 401 seeded figures are identical). The demo client now goes through the real propose, verify and publish steps and goes live, so it is gated and passes for the right reason. **Before the first real client goes ACTIVE, the bureau must run its current PAYE, pension and employer-contribution rules through the library once.** No migration.

## Merged

| PR | What | Migration |
| --- | --- | --- |
| #76 | Plan for the verified-settings gate (document only). | none |
| #75 | **Exact money arithmetic, stage 5**: `roundPlaces`; the pay path no longer uses the old `round2`; a lint guard refuses the old inline rounding, with a written exceptions list. No pay figure changes. | none |
| #74 | Plan for exact money, stage 5 (document only). | none |
| #73 | **Exact money arithmetic, stage 4b**: the leaving settlement and loans worked exactly; every settlement rounding choice kept; the loan instalment still rounds UP, now exactly (it could tip over by a kobo). | none |
| #72 | **Exact money arithmetic, stage 4a**: overtime pay, arrears and recurring percentage deductions worked exactly (overtime can be ₦0.01 higher on ties); the bank file rounds a sub-kobo amount half up with a warning; a new `pay-inputs.ts`. | none |
| #71 | Plan for exact money, stage 4 (document only). | none |
| #70 | **Exact money arithmetic, stage 3b**: the payroll engine, quick payslip and overtime hourly rate in whole kobo and exact fractions (the late rounding is kept). 1 kobo differences at exact ties only, employer-side, in my measurement. | none |
| #69 | **Exact money arithmetic, stage 3a**: an exact-fraction type, formulas, salary components and the 70:30 split in exact arithmetic (a rate of ₦50,002.45 at 70% now gives the operative ₦35,001.72); a characterization test of the engine. The engine itself was unchanged. | none |
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
