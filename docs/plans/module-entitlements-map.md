# Entitlements, step E0: the map of the app against the twelve modules

**Status: a first-pass map for you to correct. No code, no migration.** Written 2026-11-02 from the repository (`docs/plans/module-entitlements.md` is the plan). Counts are from the code. **Every "module" in the right-hand column is my guess**, built from the folder and page names and not from reading each page; the points where I am unsure are marked **?** and listed in section 3.

## 1. What is there: 230 signed-in pages, 62 action files, 28 API routes (9 scheduled jobs), 84 services

### Pages, by area, against your twelve modules

| Area (pages) | What is in it | Module I would give it |
|---|---|---|
| Dashboard (1), Me (8), Settings (19) | The home page; a person's own details, leave, appraisals, grievances, policies, data export; users, roles, security, audit log, numbering, organization | **Core**. But part of Settings is module-specific: *payroll-rules, employer-costs, statutory, recurring-deductions* (Payroll); *hr-policy, appraisal-criteria, letter-templates, training-requirements, checklists* (HR); *client-portal* (Self-service or Contracts?); *cost-centers* (Analytics?). The **me** pages for leave, appraisals, grievances and policies belong with HR and **Self-service** **?** |
| Employees (14) | Master record, new, import, bank, pension, tax, categories, departments, org chart, dependants, guarantors, next of kin, change requests | **Core** for the master record. Bank, pension and tax pages are Payroll's data; dependants, guarantors, next of kin, org chart and departments are HR. A payroll-only client still needs bank, pension and tax and a department list (your "departments" port) **?** |
| HR (25) | Onboarding, exits, requisitions, candidates, appraisals, training, relations (grievances), breaches, attrition, retention, policies, letters, contracts, data requests | **HR management** (your list says org structure, onboarding and exit, leave, letters; **recruitment, appraisals, training, relations and data breach are not in your list**) **?** |
| Leave (2) | Leave requests and approvals | **HR**; Payroll reads unpaid leave through a port |
| Payroll (26), Payslips (1), Payments (6) | Pay runs, controls, statutory schedules and remittances, payslips, bank files, payment batches | **Payroll** |
| Operations (7), Beats (3), Supervisor (1) | Work register, attendance, rosters, deployments, absence, movements, activation, site strength, bids, supervisor capture | **Time & attendance** (work register, attendance, rosters, absence) and **Contracts & deployment** (deployments, beats, bids, strength, movements). **Attendance and rosters exist**, so this module is partly built **?** |
| Clients (2), Contracts (2) | Clients, contracts, rate cards | **Contracts & deployment** |
| Sales (25) | The company's own CRM (leads, accounts, deals, quotes, handover, cases, health, reports, privacy) | **CRM** (this is the module I built; it already has an on/off switch) |
| CRM (8) | **ThreeRoots' own pipeline for selling payroll services**: leads, outreach, partners, proposals, pricing | **Not the CRM module.** This is the bureau's own sales tool (bureau mode only) **?** |
| Finance (23) | Invoices, proforma, notes, receipts, statements, billing rules; **and** bank accounts, bank reconciliation, **payables, purchase orders, vendors, fixed assets** | **Client billing** for invoices, proforma, notes, receipts, statements, billing rules. The rest (**payables, procurement, fixed assets, bank accounts and reconciliation**) are **not in your list** **?** |
| Accounting (23) | General ledger: chart of accounts, journals, manual and recurring journals, periods, trial balance, balance sheet, income statement, tax codes, WHT certificates, dimensions, AR report, reversals | **Not in your list.** Your "Integrations: accounting/GL export (Sage)" is an *export*; the app has a *full ledger inside it* **?** |
| Analytics (8), Reports (2) | Client cost, contract profitability, workforce cost, variance, locations, cost centres, payroll analytics | **Analytics** |
| Portal (8) | The client's own people: inputs, queries, register and payslip downloads | Not "Employee self-service" (that is for employees). It belongs with **Contracts & deployment** or is a module of its own ("Client portal") **?** |
| Inventory (4), Health checks (2), Service desk (2), Bureau (8) | Stock issue, payroll health checks, client queries, ThreeRoots' client management | **Not in your list.** Bureau is bureau mode, not a client module **?** |

### Actions, API routes, jobs and services

- **62 action files** map one-to-one to the areas above by name (for example `sales-*` to CRM, `payroll*`, `payslips`, `payment-file` to Payroll, `billing*`, `receipts`, `period-close` to Client billing or Accounting). A mixed file, `hr.ts` and `hr-lifecycle.ts`, `employee-*`, `personal-records`, will need splitting by function.
- **28 API routes:** payroll and payslip downloads and the bank file (Payroll); `employees/import-template` (Core or HR); `finance/statements` (Client billing); `portal/*` (client portal); `sales/*`, `unsubscribe` (CRM); `crm/proposals` (bureau pipeline); `reports/[type]` (Analytics); `me/data-export`, `data-requests/*` (Core or HR); `health-checks/*`.
- **9 scheduled jobs:** `sales-automation`, `sales-cases`, `sales-digest`, `sales-health` (CRM); `payroll-reminders` (Payroll); `journal-reversals`, `recurring-journals` (Accounting); `hr-digest`, `data-retention` (HR or Core). **A job that runs for every company must skip a company that has not bought its module**, which the CRM jobs already do (they read each company's switch).
- **84 services** (`src/server/services`) plus 24 in `services/sales`. Services are called by pages, actions and jobs; the enforcement point should be the one `assertCan`-style check at the service entry, not on every page.

## 2. What this means for the twelve modules

- **Your twelve modules do not cover everything the app contains.** Not in your list but in the app: a **general ledger and accounting**, **payables and procurement**, **fixed assets**, **bank reconciliation**, **inventory**, **recruitment, appraisals, training, grievances and data-breach handling** (HR, but wider than "onboarding and exit, leave, letters"), **health checks**, **service desk**, and the **bureau** tools. Each needs a module, a place inside one of the twelve, or "always on".
- **A payroll-only client cannot be literally "Core plus Payroll" today**, because payroll needs the employee's bank, pension and tax pages (Core data pages that are listed above under Employees), plus departments and categories. That is workable (those stay in Core), but "Payroll needs only the core" is true only if the employee master record includes them.
- **Payroll's unpaid-leave and attendance "ports"** do not exist yet: payroll reads the work register and leave directly. They would be new code.
- **Client billing "needs Deployment or CRM":** today it needs contracts and deployed days (Contracts and deployment) and cannot work from the CRM alone, because an invoice needs a client contract. A CRM-only client has no invoices.
- **The CRM already depends on nothing** (it has its own accounts and contacts), which matches your document, with one exception: a *handover* creates a client, contract and sites, which are Contracts and deployment records. A CRM-only company could not accept a handover **?**

## 3. What I need you to correct (in this order)

1. **The accounting suite, payables, fixed assets, bank reconciliation, inventory, health checks, service desk and bureau tools: which module, or always on?** Suggestion: Accounting (ledger, journals, periods, tax, fixed assets, bank) as its own module, **Payables and procurement** as another, **Inventory** as another, bureau and health checks in "bureau mode" only.
2. **Is HR wider than your description?** Recruitment, appraisals, training, relations, data breach: inside "HR management"?
3. **Employee master data:** bank, pension and tax pages: Core, or Payroll?
4. **The client portal** (Portal, 8 pages): its own module, or part of Contracts and deployment?
5. **The ThreeRoots payroll-services pipeline** (the old `/crm`): leave it as bureau-only, outside the twelve?
6. **A CRM-only company and the handover** (it creates a client, contract and sites): block accepting a handover, or allow Contracts records to exist without the Contracts module?
7. **Settings pages that belong to one module** (payroll rules, HR policy, letter templates and so on): hide them with their module? (I would.)

## 4. Next, and what I will not do yet

When you answer, I will turn this into a **precise table, page by page and function by function**, as a data file the later tests can read, and stop for your "go" before **E1 (the catalogue)**. I have changed no code, no permission and no screen. **Corrections to the earlier plan:** time and attendance is partly built (work register, attendance, rosters), so it is not "missing"; the app's finance and accounting side is much larger than the "Client billing, flat" module in your document.
