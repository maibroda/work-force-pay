# WorkforcePay: project rules for Claude Code

## What this product is
WorkforcePay is a payroll and workforce platform for Nigerian companies that deploy workers to client sites (security, cleaning, facility management, outsourced staffing). Pay comes from client contracts, sites, days worked, reliefs, sanctions and allowances, not only a fixed salary. It produces correct pay, statutory schedules (PAYE by state of residence, pension by PFA, NHF, NSITF, ITF), bank payment files and payslips. It records and calculates; it NEVER holds or moves money.

Users: payroll officer (maker), payroll manager (checker), finance or HR director (approver), operations or site supervisor, client representative (read-only), auditor (read-only), our support staff (no default access to salary data), platform administrator.

## What I (the founder) need from you
I am a payroll and finance professional, not a software engineer. I must be able to explain every line of code that touches pay, tax, access control, the audit log and bank files. So:
- Work in small steps. Explain what you are doing in plain language before and after each step.
- After any change to a critical module, write an "explain-back note" (see below) I can read.
- Never assume a business rule. If a payroll rule is unclear, STOP and ask me. List your assumption explicitly if you must proceed.

## Intended architecture (VERIFY against the repository; report differences, do not silently change it)
- Modular monolith with clear module boundaries: contracts and rate cards, workforce and deployment, attendance exceptions, payroll engine, statutory engine, approvals and audit, bank files, notifications (SMS), reporting, identity and administration.
- Likely stack: React with TypeScript (web), Node.js with TypeScript (server), PostgreSQL. Containers for deployment. Hosting intended in Lagos, Nigeria (data residency).
- Payroll and statutory engines are pure functions of their inputs, testable without a database.
- If the repository differs, tell me what differs and why before proceeding. Do not rewrite architecture without my written approval.

## Non-negotiable engineering rules
1. READ BEFORE YOU WRITE. Inspect existing code, tests, migrations and docs first. Reuse what exists. Do not create a second implementation of something that already exists. If a feature exists but is incomplete, extend it.
2. MONEY. Store and compute money as integer kobo or exact decimals. NEVER use floating-point numbers for money. Rounding rule: round half up to the nearest kobo, applied at the line where the amount is calculated. Put the rule in ONE shared utility with tests.
3. STATUTORY SETTINGS ARE DATA, NOT CODE. Tax bands, exemptions, reliefs, pension rates and bases, NHF, NSITF and ITF rates must be effective-dated settings with version history, who changed them and when, and an "adviser verified on/by" field. Payroll for production clients must be blocked if a required setting is unverified. Never hard-code a rate or threshold in logic. Do not invent or "correct" tax rules from memory: use the values I supply or the existing settings, and flag anything that looks wrong.
4. TESTS FIRST for pay, statutory, approval, access-control, audit and bank-file code. Write or extend tests before the change; they must fail without it and pass with it. The golden datasets (golden-test CSV and the cases in tests/golden) must pass on every run and are part of continuous integration. Never weaken or delete a test to make it pass; if a test is wrong, explain why and ask me.
5. SECURITY BY DEFAULT.
   - Authorisation is enforced on the SERVER for every request; hiding a button is not a control.
   - Every query is scoped to the caller's client (tenant isolation) and is tested for cross-client access.
   - Maker, checker and approver separation is enforced server-side: one user cannot do two steps on the same payroll.
   - MFA required for approve, export, settings and administrator roles.
   - Audit log is append-only and tamper-evident; no application role can update or delete entries.
   - NIN, BVN and bank details are encrypted at the field level and masked in the interface and logs.
   - Parameterised queries only; validate all input on the server; no secrets, keys or credentials in code, config files in the repository, or logs.
   - Security events are logged: logins, failures, approvals, exports, role changes, bank-detail changes, settings changes.
6. DATA. Use synthetic data only. Never ask me to paste real worker data. Never write real names, salaries or account numbers into tests, fixtures, logs or documents.
7. MIGRATIONS. Database migrations must be reversible, tested on a copy of a seeded database, and non-destructive (never drop or rewrite production data without a documented backup and my approval). Run migrations in a transaction where possible.
8. FEATURE FLAGS. New modules (billing, supervisor capture, portal, API) ship behind feature flags that default to OFF until I turn them on.
9. SCOPE DISCIPLINE. Implement only what the phase asks. Put anything extra you notice on a "findings and suggestions" list in your report; do not build it.
10. SMALL COMMITS. One logical change per commit, clear messages, a branch per task, no force-pushes. Never commit secrets. Do not modify CI settings or branch protection without telling me.
11. CRITICAL FILES. Mark files in pay, statutory, approvals, audit, access control and bank-file modules in CODEOWNERS so changes need review by me and the independent reviewer.
12. PERFORMANCE AND LOW BANDWIDTH. Payroll for 3,000 workers must complete in 10 minutes or less; page responses within 3 seconds for 95% of requests under normal load; main screens usable on a 3G-quality connection and a basic Android browser.
13. LOCALISATION. Naira with kobo precision, West Africa Time, English, Nigerian bank file formats.
14. DOCUMENTATION. Update docs, the OpenAPI spec (when the API exists), the data dictionary and release notes as part of each change.
15. HONESTY. Say plainly when something is untested, unfinished, or you are unsure. Never claim a test passes without running it. Never claim a security property you have not verified with a test.

## Workflow for every task
1. RESTATE the task in your own words and list the requirement IDs it touches.
2. INSPECT the relevant code and tests; summarise what exists.
3. PLAN in numbered steps with files you will change; wait for my "go" on anything touching a critical module, a migration or a dependency.
4. TEST FIRST, then implement, then run the full test suite, linter and type checker.
5. REPORT using the template below.

## Report template (use after every task and every phase)
- Task and requirement IDs
- What I found (existing state)
- What I changed (files, migrations, settings), in plain language
- Tests added or changed, and the full-suite result (paste the summary, do not paraphrase)
- Security and data-protection impact
- Assumptions I made and questions for you
- Risks and things I did NOT do
- Explain-back note for critical modules (below)
- Suggested next step

## Explain-back note (critical modules)
For every change to pay, statutory, approvals, audit, access control or bank-file code, write 6 to 12 lines in plain language: what the code does step by step, where each rule comes from, what could go wrong, and which test proves it works. Use payroll vocabulary, not programmer jargon, and include one worked example with numbers.

## Definition of done (every task)
- Requirements met with acceptance criteria shown by tests.
- Full suite, linter and type checks green; golden datasets green.
- No new secrets, no floating-point money, no hard-coded statutory values.
- Tenant isolation and role checks tested for any new endpoint or screen.
- Docs, data dictionary and release notes updated.
- Report and explain-back note delivered.
- Anything unresolved is listed explicitly.

## STOP conditions (stop and ask me)
- A payroll or statutory rule is ambiguous or seems wrong.
- A change needs a destructive migration, a new third-party service, a new dependency with broad access, or a change to authentication.
- A test you believe is wrong blocks you.
- You discover real personal data in the repository, fixtures or logs (stop immediately and tell me).
- You find a likely security vulnerability: report it with severity before fixing.
