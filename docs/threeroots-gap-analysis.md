# ThreeRoots spec vs what is built

Compares [FEATURES.md](FEATURES.md) with the codebase as of PR #45 (Oct 2026). "Built" means code and tests exist; "Partial" means some of it does; "Missing" means I found nothing. Entries marked *(unverified)* come from a quick search of the code, not from running the feature, and should be confirmed before relying on them.

## The big difference: whose payroll is it?

The app today is **one employer's** system. An `Organization` is the employer, its `Employee` rows are its own staff, and a `Client` is a *customer of that employer* (a company the guards are deployed to, and that gets invoiced). Everything is scoped by `organizationId`.

ThreeRoots is a **payroll bureau**: its `Client` is the *employer*, and the employees, pay structures, runs and statutory remittances belong to that employer. ThreeRoots staff work across many such employers, and later each employer's own people log in through a portal.

That is the one structural decision the rest depends on. Two ways to do it:

| | A. One organization per ThreeRoots client | B. One ThreeRoots organization, an "employer" level inside it |
|---|---|---|
| How | Each client company is an `Organization`; ThreeRoots staff get a cross-organization identity that can switch between them | Add an `Employer` (or reuse `Client`) level; `Employee`, `PayrollRun`, rules etc. gain an `employerId` |
| Isolation | Strongest: every existing query is already filtered by `organizationId`, so one client can never see another's data | Weaker: a missed `employerId` filter leaks across clients |
| Existing code | Almost no schema change; new work is the cross-org staff identity, switcher and a bureau-level view | Large change: nearly every model and query needs the new key |
| Per-client config | Natural (pay components, rules, calendar, chart of accounts are already per organization) | Needs per-employer versions of each |
| Portal users | A client user simply belongs to their one organization | Need a separate scope on top of the organization |
| Bureau's own books | ThreeRoots keeps its own organization for its CRM, invoicing and ledger | Mixed in with client payroll data |

**Recommendation: A.** It matches the confidentiality principle (hard isolation per client), reuses everything built so far (payroll, tax rules, audit, retention, data-protection), and keeps ThreeRoots's own finance in a separate organization. The cost is a bureau layer on top: a staff identity that can act in several organizations, a client list that shows them all, and reporting across them.

## Coverage, by spec section

| Spec | Status | Notes |
|---|---|---|
| 3.1 Bureau layer (client organizations, staff access, engagement terms) | Built (first part) | Option A: each client is its own organization; staff switch between the clients they are given; package, term, fees, contact, SLA and data-processing terms recorded per client; audited in the client's log. Still to do: HR + Finance verified rule library that publishes to clients, per-client payroll calendar. |
| 3.1 Client records, sites, headcount | Partial | `Client`, `Contract`, `Beat` exist, but as the employer's customers. Under option A the employer becomes an `Organization`; package, contract term and start date are new fields on a bureau-level client record. |
| 3.1 Packages, fees, add-ons | Missing | Billing rules exist for the security-company model (per-service-type billing of the employer's customers). A package/per-employee/minimum/onboarding-fee model for ThreeRoots's own invoicing is new. |
| 3.1 Per-client payroll calendar | Built | Agreed rhythm per client, concrete dates per month (adjustable with a reason), and where each deadline stands read from the payroll. Email reminders built (off by default per client). |
| 3.1 Per-client rule configuration | Built | Salary structures, components, overtime, deduction types are per organization. |
| 3.1 Agreement, SLA, data-processing terms | Partial | A data-protection policy and retention rules exist; terms are not stored per client. |
| 3.2 Employee master data | Built | Records, categories, sites (beats), bank/pension/tax details, change requests with approval. |
| 3.2 Bulk import and validation | Built (CSV) | Template, preview with row-level errors and warnings, duplicate checks within the file and against existing staff, all-or-nothing import, unalterable batch record. Account numbers are checked for length only (no bank check digit yet); `.xlsx` is not read directly. |
| 3.2 Joiners, leavers, effective-dated history | Partial | Exits and clearance, movements and employment contracts exist; a generic effective-dated change history for pay fields should be checked. |
| 3.2 Encrypted, masked sensitive fields | Partial | Sensitive changes are approved and audited and fields are permission-gated. No field-level encryption was found. |
| 3.3 Input templates | Partial | Overtime, arrears, earnings, deductions and loans each have entry screens; per-client downloadable templates and import do not exist. |
| 3.3 Input tracker, cut-offs, reminders | Partial | Tracker per client and month (received / not applicable / expected, lateness against the cut-off, evidence counts), a log of missing or inconsistent items, and a bureau-wide "due this week" view, and email reminders to the client contact and the team (daily cron, once a day at most, logged). |
| 3.3 Change requests with reasons | Built | Employee detail changes. |
| 3.4 Gross-to-net, statutory rules as data | Built | Versioned, effective-dated PAYE, pension and payroll rule tables; engine, supplementary runs, final settlements, Quick Payslip. |
| 3.4 Reproduce past payrolls | Built | Runs record the rule version used. |
| 3.4 Retro adjustments | Built | Supplementary payroll and arrears. |
| 3.4 Test mode and demo data | Built | Seeded demo organization, and the ThreeRoots demo client (Acme Facilities Ltd: 30 employees, 3 sites, October 2026 locked) with an acceptance test for the spec's section 8 checks. |
| 3.5 Run workflow | Partial | States today: Draft, Calculated, Pending approval, Approved, Locked, Paid, Superseded, plus a validation screen. Reconciliation is now a recorded sign-off (not a separate state). Missing: Inputs collected, a separate client-approval record. |
| 3.5 Maker-checker enforced | Built | Everyone who calculates or submits a run is recorded and none of them can approve it or override its errors; a database trigger backs it. Acceptance check #2 is met. |
| 3.5 Validations and variance report | Built | Critical/warning validations with Finance override, plus headcount, total and per-person variance against the previous payroll, each needing a written explanation before submission. |
| 3.5 Reconciliation | Built | Bridge of headcount, gross and net from the previous payroll, with a recorded sign-off (required before submission if the organisation chooses). The ledger side comes later. |
| 3.5 Locked is immutable, corrections as adjustments | Built | |
| 3.6 Payslips | Built (PDF; no password) | A PDF per employee (own earnings and deductions only, identifiers masked), downloadable singly or as a zip, with email delivery as an option per organization, once per payslip, recorded. PDF password protection was not asked for. |
| 3.6 Register, summary, remittance schedules | Built | Payroll register, PAYE, pension, NSITF, ITF, NHF schedules, statutory remittance tracking. |
| 3.6 Bank payment files per bank | Built (one generic layout) | Excel file with Name, Account Number, Bank Code, Amount, Payment Description from a locked payroll; refuses unusable details unless left out on purpose; every file recorded with a fingerprint. Bank-specific layouts only if a client's bank rejects the generic one. Bank codes are a starting list to confirm. |
| 3.6 Management reports | Partial | Many schedules exist; cost by site, headcount movement and variance explanations need checking against the list. |
| 3.6 Branded templates | Missing | |
| 3.7 Compliance calendar, evidence, rule-change log | Partial | Remittances have due dates. No calendar, reminders or evidence upload. The rule-change log is built: the Statutory Rule Library records who proposed, who verified (HR and Finance), and when each version was published to which clients. |
| 3.8 Client portal | Partial (approval, calendar, inputs view) | Client approver and HR contact roles with compulsory two-factor, invited by email, limited to their own organization; calendar and input status, payroll review and approve / send back with the separate client-approval record, enforced at the lock. Still to do: clients submitting inputs and employee changes, downloading reports and payslips, and the query log. |
| 3.9 CRM and pipeline | Missing | A sales-commission design note exists (`docs/sales-commission-design.md`); no leads, stages, activity log or referral partners. |
| 3.10 Pricing and proposals | Missing | |
| 3.11 Payroll Health Check | Missing | |
| 3.12 Billing and collections | **Largely built** | The finance work of Phases 1 to 5 covers invoicing, receipts, advances, credit/debit notes, ageing, statements, VAT/WHT, period close. What is new is subscription-style fees, MRR and churn. |
| 3.13 Service desk | Partial | A data-breach register and data-access requests exist. Client query/issue log with SLA timers does not. |
| 3.14 Performance dashboard | Missing | |
| 4 MFA for staff | Built | TOTP two-factor and session invalidation exist. Enforcement for all staff roles is a setting to confirm. |
| 4 Audit log of changes | Built | Every service writes who, what, when and reason. |
| 4 Audit of *reads* of sensitive data | Missing *(unverified)* | Changes are logged; reads were not found to be. |
| 4 Retention and deletion | Built | Records retention and erasure workflows. |
| 4 Data-protection register | Built | Policies and acknowledgements, access requests, breach register. |
| 4 Backups and tested restore | Partial | Dumps and restores are done by hand for migrations; not an automated, documented procedure. |

## Roles

The spec's roles do not match the existing ones (`COMPANY_ADMIN`, `HR_ADMIN`, `PAYROLL_ADMIN`, `FINANCE`, `OPERATIONS`, `AUDITOR`, ...). Permissions are fine-grained and role-to-permission is a table, so this is a mapping and a few new permissions, not a redesign:

| Spec role | Likely mapping |
|---|---|
| Founder / Managing Consultant | `COMPANY_ADMIN` |
| Payroll Officer (preparer) | `PAYROLL_ADMIN`: prepare, import, calculate; loses `payroll.approve` |
| Payroll Reviewer (checker) | new role with `payroll.approve`, variance review |
| Client Service Administrator | new role: onboarding, input tracker, queries, distribution |
| Business Development Executive | new role: CRM only, no payroll permissions |
| Client Approver / Client HR Contact | new portal roles, scoped to one organization |
| Auditor | `AUDITOR` |

## Proposed order

The finance phases already built are the foundation for 3.12 and for ThreeRoots's own books; they do not need redoing. The MVP gap is in the payroll workflow and the bureau layer.

1. **Close out finance in flight.** Commit the year-end close that is built and verified. Park the rest of Phase 5 (input VAT, supplier notes, supplier payments) until after the MVP items below, since a payroll bureau's own payables are small.
2. **Payroll controls (smallest, highest value).** *Done:* preparer ≠ approver, variance and headcount validations with required explanations, reconciliation sign-off. *Still to do:* a separate client-approval record (needs the client roles from the portal work).
3. **Bureau layer (needs your decision on A or B).** Cross-organization staff identity and client switcher, client onboarding (package, term, fees, SLA and data-processing terms), per-client payroll calendar.
4. **Inputs.** Per-client templates, import with validation, submission tracker with cut-offs and reminders. Employee bulk import with the duplicate / missing-field / account-number checks.
5. **Outputs.** PDF payslips (and the delivery decision), per-bank payment file formats for the first bank(s) you choose, branded templates, management reports.
6. **Security.** Field-level encryption for bank and identifier fields, audit of reads of sensitive data, MFA enforced for all staff, documented backup and restore.
7. **MVP demo.** Fictional client with 30 employees across 3 sites, run end to end against the acceptance checks in section 8 of the spec.
8. **Phase 2 and 3.** Client portal, compliance calendar, then CRM, pricing and Health Check, then service desk and performance dashboard, in the order of the spec.

## Decisions needed

1. **A or B** above (recommend A).
2. **Which bank formats first** (spec section 7), since each is its own file layout.
3. **Payslip delivery**: portal download only, or protected email too. Affects whether PDF password protection is needed at all.
4. **Statutory rules**: who verifies the PAYE, pension, NHF, NSITF and ITF tables after the 2026 reforms, and when. The rule tables are data, so this is a task rather than a code change, but nothing should go live on rates nobody has checked.
5. **Whether the Phase 5 finance items wait** until after the MVP items (recommended), or continue first.
