# WorkforcePay: Feature Spec for ThreeRoots Payroll Services

Source: features identified in the ThreeRoots GTM, service-design and operating-controls discussion (Oct 2026). Paste this into the repo (for example `docs/FEATURES.md`) and point Claude Code at it when planning each phase.

How this spec maps onto what is already built, and the resulting roadmap, is in [threeroots-gap-analysis.md](threeroots-gap-analysis.md).

## 1. Product context

- **Business:** ThreeRoots Payroll Services, a managed payroll outsourcing company in Lagos. Tagline: People. Pay. Precision.
- **Operating model:** Managed outsourcing. ThreeRoots prepares payroll; the client approves and funds it. The app is first an **internal operations tool** for ThreeRoots staff, then gains a **client portal**.
- **Initial markets:** Security and facilities companies (multi-site, shifts, overtime, allowances), then SMEs of 10 to 100 staff.

### Design principles
1. **Client keeps custody of funds.** The app produces payment files and schedules; it never moves money.
2. **Maker-checker everywhere.** The person who prepares a payroll cannot be its only approver.
3. **Everything is auditable.** Every change to payroll data has who, what, when and why.
4. **Statutory rules are data, not code.** Rates, bands and thresholds live in versioned rule tables with effective dates, so they can be updated without a release. Verify current Nigerian rules (PAYE, pension, NHF, NSITF, ITF) before go-live; the 2026 tax reforms may have changed some.
5. **Confidentiality first.** Salary and bank data are treated as high-risk personal data under the Nigeria Data Protection Act 2023.
6. **No guarantees in the product.** Reports show process evidence, not "zero errors" or "certified compliance" claims.

## 2. Roles and permissions

| Role | Can do |
|---|---|
| Founder / Managing Consultant | Everything; final internal approval; pricing and rule-table changes |
| Payroll Officer (preparer) | Prepare payroll, import inputs, generate drafts; cannot approve own payroll |
| Payroll Reviewer (checker) | Review variances and reconciliations; approve for client sign-off |
| Client Service Administrator | Onboarding, input tracking, query log, report distribution |
| Business Development Executive | CRM, proposals, pipeline only; no payroll data |
| Client Approver | Review draft and approve payroll (portal) |
| Client HR Contact | Submit changes, view reports (portal) |
| Auditor (read-only) | View audit trail and reports |

## 3. Modules and features

### 3.1 Client and contract management (MVP)
- Client records: entity details, contacts, sites, headcount, package, start date, contract term (6 or 12 months)
- Packages: Payroll Essentials, Payroll & Compliance, Managed Payroll Plus, Enterprise, Payroll Health Check
- Fees: per-employee rate, monthly minimum, one-off onboarding fee, add-ons
- Per-client payroll calendar: input cut-off, draft date, approval deadline, pay date, remittance dates
- Per-client rule configuration (pay components, overtime rules, allowance types, deduction types)
- Service agreement, SLA and data-processing terms stored per client

### 3.2 Employee master data (MVP)
- Employee records per client: ID, role, site, category, pay structure, bank details, pension and tax identifiers
- Multiple sites and employee categories per client; multi-entity support later
- Bulk import and validation from Excel/CSV (duplicates, missing fields, invalid account numbers)
- Joiners, leavers and change history with effective dates
- Sensitive fields (bank, identifiers) encrypted and masked by default

### 3.3 Payroll inputs and change control (MVP)
- Monthly input templates per client: attendance, overtime, allowances, bonuses, deductions, loans, exits
- Input submission tracker with cut-off dates, reminders and a log of missing or inconsistent items
- Change requests with approval trail; nothing changes pay data without a recorded reason

### 3.4 Calculation engine (MVP)
- Gross-to-net calculation from configurable pay components
- Statutory deductions and employer contributions from versioned rule tables (PAYE, pension, NHF, NSITF, ITF)
- Rule table history, so past payrolls can be reproduced under the rules in force at the time
- Retroactive adjustments and final settlement computations
- Test mode with the fictional demo dataset

### 3.5 Payroll run workflow (MVP)
States: **Inputs collected, Draft, Validated, Reconciled, Internal review, Client approved, Locked, Paid (client-confirmed)**
- Automated validations: headcount vs prior month, large variances, negative pay, missing bank details
- Variance report with required explanations
- Reconciliation to prior payroll, headcount and (later) ledger
- Maker-checker enforced by the system; separate approval record for the client
- Locked payrolls are immutable; corrections create adjustment entries

### 3.6 Outputs and reporting (MVP)
- Payslips (PDF), password-protected or delivered through the portal
- Payroll register and payroll summary
- Bank payment upload files (per bank format)
- Statutory remittance schedules with due dates
- Management reports: payroll cost by site, headcount movement, overtime and allowance analysis, variance explanations
- Branded ThreeRoots templates

### 3.7 Compliance calendar (Phase 2)
- Calendar of client and statutory deadlines with reminders
- Evidence tracking: remittance proof uploaded and linked to the run
- Rule-change log with who updated what and when

### 3.8 Client portal (Phase 2)
- Submit payroll inputs and employee changes
- Review draft payroll and variances; approve or reject with comments
- Download payslips, registers and reports
- Query log with status and response times
- Client users and MFA

### 3.9 Sales CRM and pipeline (Phase 2)
- Leads and prospects: segment, headcount, decision-maker, source
- Stages: Qualified, Discovery, Proposal, Pilot, Won, Lost
- Outreach activity log (target of 10 qualified contacts per working day)
- Referral partners (accountants, HR consultants) with referral tracking and commission
- Sales dashboard: prospects contacted, discovery meetings, proposals, conversion, MRR

### 3.10 Pricing and proposal tool (Phase 2)
- Proposal builder from package, headcount and add-ons
- Delivery cost calculator: monthly hours, software and support cost, overhead and target gross margin; headcount alone does not set the price
- Proposal export (PDF) with scope and responsibilities; VAT treatment noted

### 3.11 Payroll Health Check (Phase 2)
- Checklist template covering input and approval controls, calculations and reconciliations, employee records and changes, statutory schedules, reporting and audit trails
- Findings log with severity and recommendations
- One-page summary report export, with the disclaimer that detailed reviews are separately scoped

### 3.12 Billing and collections (Phase 3)
- Monthly invoices, onboarding fees and add-ons
- Payment tracking, days-to-collect and overdue reminders
- MRR, churn and revenue per client

### 3.13 Service desk (Phase 3)
- Issue and query log per client with SLA timers
- Escalation for missed deadlines and potential data incidents
- Incident register for data-protection events

### 3.14 Performance dashboard (Phase 3)
- On-time payroll delivery rate, first-pass accuracy and correction count
- Query turnaround time, client satisfaction and renewal tracking
- Workload per payroll officer (employees and clients managed)

## 4. Security and data protection (cross-cutting, from day one)
- Role-based access with MFA for staff
- Full audit log of reads of sensitive data and all changes
- Encryption in transit and at rest; field-level encryption for bank and identifier fields
- Retention and deletion rules per client contract
- Secure file import and export; no payroll files by personal email or chat
- Backups and a tested restore procedure
- Data-processing terms recorded per client; incident-response procedure and register

## 5. Phasing

| Phase | Scope |
|---|---|
| **MVP** | 3.1 to 3.6, security basics, demo dataset: enough to run one client's payroll end to end |
| **Phase 2** | Client portal, compliance calendar, CRM, pricing tool, Health Check |
| **Phase 3** | Billing, service desk, performance dashboard, multi-entity, ledger integrations |

## 6. Non-goals
- Holding or moving client salary funds
- Guaranteeing zero errors or certifying legal compliance
- Selling the app as standalone payroll software (a possible later hybrid, not in scope now)

## 7. Open decisions
- Statutory rule source and who verifies updates each period
- Hosting region and backup approach
- Bank file formats to support first
- Whether the portal launches before the second client
- Payslip delivery method (portal download vs protected email)

## 8. Acceptance checks for MVP
- One fictional client with 30 employees across 3 sites runs a full month from inputs to locked payroll
- The preparer cannot approve their own payroll
- Changing a statutory rate creates a new effective-dated rule; old payrolls still reproduce
- Every edit to employee pay data appears in the audit log
- Payslips, register, bank file and remittance schedule export correctly
