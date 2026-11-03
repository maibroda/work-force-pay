# Entitlements, step E0, second pass: every page, action, route, job and service against a module

**Status: a table for you to correct. No code, permission, migration or screen changed.** Generated from the repository by a script (2026-11-02, updated 2026-11-03) with your rulings: accounting, payables and procurement, and inventory are their own modules; **on 2026-11-03 you accepted my recommendations, so HR covers recruitment, appraisals, training, grievances, breaches, policies, letters and attrition; staff loans go under Payroll; the employee bank, pension and tax pages stay in the core; each settings page follows its module; the client portal is its own module; the bureau tools are bureau mode only.** **A "guess" is my reading of a folder or file name, or of the first line of what the file says it does, that you have not ruled on; "decided" means you ruled (or accepted my recommendation).** The full table, one line per page, action file, service, API route and job, is in `docs/plans/module-entitlements-table.json` (it is data, so the later tests can read it).

## Totals

412 entries: 233 pages, 63 action files, 85 services (the 24 files in `services/sales` count as one), 19 API routes, 12 scheduled jobs. **48 are still guesses (5 of the pages); 0 are unmapped.**

| Module | Pages | Actions | Services | API and jobs | Guesses |
|---|---|---|---|---|---|
| Core platform (always on) | 18 | 4 | 12 | 6 | 11 |
| HR management | 38 | 12 | 18 | 2 | 0 |
| Payroll | 38 | 8 | 19 | 4 | 13 |
| Time & attendance | 5 | 0 | 0 | 0 | 5 |
| Contracts & deployment | 10 | 3 | 4 | 0 | 5 |
| CRM | 26 | 11 | 1 | 10 | 0 |
| Client billing | 12 | 4 | 4 | 1 | 1 |
| Employee self-service | 8 | 0 | 0 | 0 | 0 |
| Analytics | 11 | 0 | 2 | 1 | 3 |
| Accounting (decided: its own module) | 27 | 11 | 15 | 2 | 10 |
| Payables and procurement (decided) | 7 | 3 | 3 | 0 | 0 |
| Inventory (decided) | 4 | 1 | 1 | 0 | 0 |
| Client portal (decided: its own module) | 9 | 2 | 1 | 3 | 0 |
| Bureau tools (decided: bureau mode only, not a module) | 20 | 4 | 5 | 2 | 0 |

## What I need you to confirm

### Core platform (always on): 11 guess(es)

Other: service `audit.ts`, service `auth-audit.ts`, service `employees.ts`, service `job-runs.ts`, service `retention.ts`, job `/api/cron/audit-heads`, job `/api/cron/audit-seal`, job `/api/cron/audit-verify`, api `/api/data-requests/[id]/export`, api `/api/employees/import-template`, api `/api/me/data-export`

### Payroll: 13 guess(es)

Other: actions `client-inputs.ts`, service `client-inputs.ts`, service `inputs.ts`, service `payments.ts`, service `payroll-controls.ts`, service `payroll-reminders.ts`, service `quick-payslip.ts`, service `settlements.ts`, service `statutory-verification.ts`, service `statutory.ts`, service `structures.ts`, service `year-end.ts`, job `/api/cron/payroll-reminders`

### Time & attendance: 5 guess(es)

Pages: `/operations/absence`, `/operations/attendance`, `/operations/rosters`, `/operations/work-register`, `/supervisor`. Why: partly built: work register, attendance, rosters; supervisor capture on a phone.

### Contracts & deployment: 5 guess(es)

Other: actions `operations.ts`, actions `workforce.ts`, service `contracts.ts`, service `operations.ts`, service `rates.ts`

### Client billing: 1 guess(es)

Other: api `/api/finance/statements/[clientId]`

### Analytics: 3 guess(es)

Other: service `analytics.ts`, service `reports.ts`, api `/api/reports/[type]`

### Accounting (decided: its own module): 10 guess(es)

Other: actions `certificates.ts`, actions `tax-engine.ts`, service `certificates.ts`, service `financial-statements.ts`, service `gl-posting.ts`, service `ledger-integrity.ts`, service `posting.ts`, service `tax-engine.ts`, job `/api/cron/journal-reversals`, job `/api/cron/recurring-journals`

## Things the table shows that change the plan

- **A job that runs for every company** (the 12 scheduled jobs) must skip a company that has not bought its module. Three of the four CRM jobs (digest, cases, health) already do, by reading each company's switch. **The fourth, automation, did not: it ran every enabled rule without checking that the company's sales module was still on. That was fixed in #111 (it now stops when the module is switched off).** The payroll reminder, the two accounting jobs and the two HR jobs would need the same check as the other three.
- **Mixed files.** Two action files, `hr` and `hr-lifecycle`, and `workforce` and `operations`, mix modules and would have to be split by function before they can carry one declaration.
- **The client portal** is the largest group with no home in your list (15 entries): the pages and routes a client's own people use. It needs a decision (its own module, or part of Contracts and deployment).
- **Bureau tools** (31 entries: ThreeRoots' own pipeline, client queries, health checks, the bureau's client management) are guessed to be "bureau mode", not something a client buys.
- **HR is the biggest guess area** (0 guesses): recruitment, appraisals, training, grievances, loans, certificates and the personal-record pages are outside your description of HR.
- **Time and attendance** has only 5 entries today: rosters, attendance, work register, absence and supervisor capture. Clocking is not built.

## How this will be used

When you have confirmed or corrected the guesses, this file becomes the declaration the enforcement step reads, and a test fails if any new page, action, route, job or service is not in it. Until then it is only a table.
