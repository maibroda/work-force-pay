# WorkforcePay

Multi-tenant workforce deployment, beat management and payroll platform for Nigerian security,
facilities, cleaning, logistics and outsourcing companies — where operatives move between clients,
contracts and beats (locations) within a payroll month.

**Stack:** Next.js 15 (App Router) · React 19 · TypeScript · Tailwind CSS + shadcn-style UI · PostgreSQL ·
Prisma 6 (pg driver adapter) · Zod · React Hook Form · Recharts · JWT sessions (jose, httpOnly cookie) ·
Sentry (error tracking) · Resend (transactional email) · Vitest · Playwright · ESLint · Prettier.

---

## Quick start

Requirements: **Node.js 20+** and **PostgreSQL 14+**.

```bash
# 1. Install
npm install                      # also runs `prisma generate`

# 2. Configure
cp .env.example .env             # set DATABASE_URL, TEST_DATABASE_URL, AUTH_SECRET
createdb workforcepay            # or create the databases in pgAdmin
createdb workforcepay_test

# 3. Database: run migrations + load demo data
npm run db:setup                 # = prisma migrate deploy && tsx prisma/seed.ts

# 4. Run
npm run dev                      # http://localhost:3000
# or production mode
npm run build && npm start
```

> `npm run db:seed` **truncates all WorkforcePay tables** and reloads the demo data. Run it again any
> time to reset the demo.

### Demo credentials (password for every account: `Password123!`)

| Role          | Email                        | Use it to…                                                           |
| ------------- | ---------------------------- | -------------------------------------------------------------------- |
| Company Admin | admin@demosecurity.test      | everything                                                           |
| Payroll Admin | payroll@demosecurity.test    | structures, inputs, run/recalculate payroll                          |
| Finance       | finance@demosecurity.test    | approve inputs, override criticals, approve & lock payroll, payments |
| Operations    | ops@demosecurity.test        | clients, beats, deployment, movements, work register                 |
| HR Admin      | hr@demosecurity.test         | employee master, overrides                                           |
| Auditor       | auditor@demosecurity.test    | read-only everything + audit trail                                   |
| Supervisor    | supervisor@demosecurity.test | mobile "Today's work register" for his beats                         |
| Employee      | emp25@demosecurity.test      | mobile self-service for EMP-000025                                   |
| Super Admin   | superadmin@workforcepay.test | platform admin                                                       |
| Org B admin   | admin@northernguards.test    | second tenant — proves isolation                                     |

---

## Business rules implemented

### Earnings structure & the 70:30 sharing ratio

```
Client agreed rate (per head / month)      ₦120,000
 ├─ 70%  Operative's monthly gross          ₦84,000  → split by the salary structure
 └─ 30%  Management share (cost of guards)  ₦36,000  → funds employer pension, margin
```

Default **Standard Security Workforce Structure** (percent of the operative's gross):

| Basic | Housing | Transport | Entertainment | Meal | Utility | Leave | Medical | Clothing | Total    |
| ----- | ------- | --------- | ------------- | ---- | ------- | ----- | ------- | -------- | -------- |
| 10%   | 14%     | 15%       | 5%            | 15%  | 20%     | 2.5%  | 5%      | 13.5%    | **100%** |

- **Flexible per client.** Hierarchy `CLIENT → CONTRACT → EMPLOYEE CATEGORY → SALARY STRUCTURE → AGREED RATE`.
  Each client/contract can have its own structure and its own agreed rate, and the sharing ratio can be
  changed per contract (default 70) or per rate line.
- **Effective-dated.** A new rate end-dates the old one; June payroll uses June's rate, July uses July's.
  (Demo: Global Insurance ₦100,000 → ₦120,000 from 1 July 2026.)
- **Validation.** Activation is blocked unless percentages total 100% — _"Salary structure percentages
  must total 100%."_ — unless the structure is explicitly marked **PARTIAL**.
- **Component types:** PERCENTAGE, FIXED_AMOUNT and FORMULA (safe parser: `GROSS`, earlier component
  codes, `MIN/MAX/ROUND`, e.g. `MIN(GROSS * 2%, 3000)`).
- **Employee Salary Override** (e.g. Basic 12% for one employee) needs reason, effective date and
  approver — the base structure is never modified.
- Creating structures never changes the default; active structures are cloned, not edited, so history
  is preserved (payroll records also snapshot every line).

### Pension

Employee **8%** and employer **10%** of **Basic + Housing + Transport** (configurable, versioned). Employer
pension is computed automatically for remittance, grouped by PFA, and never reduces net pay.

### PAYE — Nigeria Tax Act 2025 (versioned rule engine)

Seeded rule `NG-PAYE-NTA2025 v2026.1`, effective 1 Jan 2026: annual chargeable income bands
₦0–800k 0% · next ₦2.2m 15% · next ₦9m 18% · next ₦13m 21% · next ₦25m 23% · above ₦50m 25%.
Reliefs: employee pension, rent relief (20% of declared annual rent, max ₦500,000); minimum-wage
exemption. Overtime / arrears / one-off earnings are taxed at the marginal rate. Rates live in
`TaxRule / TaxBand / TaxRelief / TaxExemption` tables and every payroll run stores the rule version used.

> ⚠️ **Verify the tax rules against current Nigerian law and official NRS / State IRS guidance before
> production use.** New versions can be added under _Settings → Statutory rules_ without code changes.

### Multi-location payroll (the core requirement)

- Hierarchy: **Client → Contract → Beat** (a beat can carry an optional bid reference; "Bids" groups them).
- An employee can work at any number of beats in one month. Payroll **never** uses "current location";
  it reads the **Work Register** (one row per employee per day, recorded against the beat) for the
  period, splits it into beat × rate segments, prorates each segment, and allocates gross, overtime,
  employer pension, client billing and net pay to every client and beat worked.
- The payslip shows **every location worked** (dates, client, beat, days).
- Payroll reports roll up **by client and by beat** (`Reports → Client / Beat Report`, register filters).

Demo: **EMP-000025** in September 2026 — ABC Bank Victoria Island (1–10), Marina (11–18),
Ikoyi (19–25), XYZ Manufacturing Lekki (26–30).

### Business lines & employer add-on costs

- Every **contract** is classified **GUARDING** or **OUTSOURCING / RESOURCING** (Contracts page — change
  it inline any time; drives future payroll only, never a locked run). Employees with **no contract**
  (pay-rate, Head Office) are **back-office** by definition and are never charged these costs.
- Beyond employer pension, guarding and outsourcing contracts carry employer add-on costs, computed per
  work segment and configurable at **Settings → Employer Cost Rules** (versioned, effective-dated):
  **ITF** and **NSITF-ECA** — 1% each of gross salary; **Insurance** (7.5%), **Recruitment, Training &
  Vetting** (10.5%) and **Annual Leave Reliever** (22%) — % of (management fee less employer pension, ITF,
  NSITF and NHF/medical if configured); **Uniform & Kits** (25% of the same base) for **GUARDING** only;
  an **Outsourcing Leave Allowance** (20% of Basic) for **OUTSOURCING** only, in place of Uniform & Kits.
- These appear on the payslip as employer contributions, roll up into the payroll run's totals and
  **Employer add-on costs** panel, reduce client contribution/margin in Client Profitability and
  Client/Beat Cost, and post to the general ledger automatically at lock (their own expense + accrued
  payable account each — Accounting → Payroll GL Mapping).

### Attendance: days in the month vs. days worked

- Attendance is still recorded day by day per beat (Operations → Attendance), which is what payroll
  actually reads. Each beat also has a **Monthly attendance (quick entry)** panel: "days in the month" is
  fixed by the calendar (e.g. August = 31) and "days worked" defaults to that but is adjustable down to
  what the guard actually worked (e.g. 17) — the shortfall is marked absent automatically. Approved leave
  days are left untouched. The payslip already shows this pair as **"Days worked: X / basis days"**.

### Controls

- Automatic employee numbers (configurable prefix/digits/next number; unique per org in the database;
  never change on transfer).
- Location / client mismatch detection at attendance entry and in validation — **RED ALERT — Client
  mismatch detected**. Approval is blocked until resolved (relief / correction / acknowledgement workflow)
  or overridden by Finance with a documented reason.
- Overtime validation (active employee, belongs to beat/client that date, period, monthly hour limit,
  amount = hours × rate, no duplicates, approval reference required).
- Deductions without authority are rejected: _"Deduction cannot be processed because approval/reference
  documentation is missing."_
- Duplicate personnel (bank account, TIN, pension PIN, phone, name+DOB, fuzzy name) are flagged, never deleted.
- Bank validation (missing bank / account / name, 10-digit NUBAN, duplicate accounts).
- Joiners, leavers, assignment changes, no deployment, no attendance are listed in validation.
- Payroll lifecycle: OPEN → (recalculate as often as needed) → PENDING VALIDATION → PENDING APPROVAL →
  APPROVED → **LOCKED** (operational edits for the period are blocked; payroll posts to the GL) → PAID → CLOSED. Post-lock corrections go
  through a **supplementary payroll** with marginal PAYE.
- Full **audit trail** (user, time, action, entity, old/new values, reason, role/IP metadata).
- Multi-tenancy: every org-owned row has `organizationId`; every service query is scoped server-side.

### Annual leave

- Every employee is entitled to **10 working days a year** (Settings → Leave Policy: days, months of service
  before leave is due — default **12** — and the working week, Mon–Fri by default).
- Leave falls due on the employee's service anniversary and renews each year after; the leave year runs
  anniversary to anniversary and leave must start within it. An employee can apply the day it is due
  (**My Leave**, mobile-first) — before that the page shows when it falls due.
- Applying reserves the days straight away (no over-booking, no overlapping requests, no back-dating).
- The **supervisor of the guard's beat** approves or rejects (rejection needs a reason). Supervisors only see
  their own guards; nobody can decide their own leave; HR / Company Admin can decide when a guard has no
  supervisor. Approval writes paid **LEAVE** days into the work register, so payroll pays them; cancelling
  approved leave before it starts removes them again. Approval is blocked for dates in an approved/locked
  payroll period.
- Leave balances (HR view) list every employee's entitlement, taken, pending and remaining days.

### General-ledger posting

- Locking a payroll run **automatically posts one balanced journal** to the general ledger, in the same
  transaction as the lock — so a payroll can never be locked without its ledger entry. Closing a period
  posts anything still missing before it closes (**Payroll → Periods → Close period**).
- Each payroll head posts to its own account (Accounting → Payroll GL Mapping): earnings debit an expense
  account (Basic, Housing, Transport, Overtime, Arrears, …); deductions credit a liability (PAYE, employee
  pension, penalties) or receivable (loans, advances); employer pension debits expense and credits a payable;
  net pay credits _Net Salaries Payable_. A default Nigerian payroll chart of accounts is created for every
  organization; rename/add accounts and remap heads to match your own ledger.
- Posting is idempotent (one journal per run — locking, closing and re-posting never double-post). A head with
  no mapping of its own posts to the default "Other" account and is flagged on the journal; a journal that does
  not reconcile to net pay stops the lock. Payrolls locked before this feature can be posted from
  Accounting → Payroll Journals.

### Client billing & receivables

- **Billing & Receivables** (Finance / Accounting) generates one invoice per client from a locked payroll
  run's client billing, with one line **per employee category** billed (Guard, Supervisor, …) —
  quantity × rate = amount, prefixed with the contract name when a client has more than one contract on
  the invoice. Invoices are numbered (`INV-######`), dated to the period end with a 30-day due date, and
  never edited once issued — corrections go through the next run.
- **VAT and withholding tax.** Each run's invoices can carry a VAT % (added on top of the subtotal) and an
  expected withholding-tax % (informational — WHT doesn't reduce the amount invoiced; it estimates what
  the client is expected to withhold and remit to the tax authority on your behalf when they pay).
- **Deductions, not just payments.** A client rarely pays the full invoice in cash. Besides recording a
  cash **payment** (`ClientReceipt`), Finance can record a **deduction** (`ClientInvoiceDeduction`) for
  withholding tax actually withheld, an agreed leave-allowance credit, or any other client-side deduction
  — each one **requires a documented reason and a supporting document reference** (WHT credit note number,
  correspondence, etc.), never silent. Status moves ISSUED → PARTIALLY PAID → PAID once payments +
  deductions cover the total; an unpaid balance past the due date shows as overdue.
- The Billing & Receivables page doubles as the monthly billing/receivable report: totals billed, received,
  deducted and outstanding, both overall and broken down by client, filterable by client and date range.
- An invoice with no payments or deductions recorded against it can be cancelled with a documented reason;
  one with either cannot be.

### Contract profitability

- **Contract Profitability** (Analytics) breaks down each contract's Revenue and Cost by employee category
  (quantity × rate, reconciling exactly to the segment actually billed/paid — even when some employees
  were prorated mid-month), lists **Other Costs individually** (Employer Pension, ITF, NSITF-ECA, Insurance,
  Uniform & Kits, Recruitment/Training & Vetting, Annual Leave Reliever, Outsourcing Leave Allowance — see
  Employer add-on costs above), then computes:
  ```
  Gross Contribution   = Revenue − Direct Cost − Other Costs
  Back Office Charges  = Revenue × Back Office Charge % (Settings → Payroll Rules, default 15%)
  Net Contribution     = Gross Contribution − Back Office Charges
  ```
  matching the standard contract P&L layout, with Gross/Net Contribution % and a negative Net Contribution
  shown in parentheses. Filterable by payroll run and by a single contract.

### Navigation

- The sidebar is grouped into collapsible menus — **Dashboard, Workforce / Personnel, Payroll, Operations,
  Leave Management, Finance / Accounting, Analytics, Settings / Support, My Workspace** — matching how the
  business is organized. Click a menu to expand it; the menu containing the current page auto-expands.
  Long menus (Payroll, Finance / Accounting) carry small sub-headings (e.g. "Payments", "Payroll reports")
  above the items they group. The Reports hub (`/reports`) mirrors the same grouping.

### Security & platform hardening

- **Login protection.** Rate limiting locks an account for 15 minutes after 5 failed attempts;
  lockout is indistinguishable from a wrong password to the client, so it can't be used to
  enumerate valid accounts.
- **Two-factor authentication.** Optional TOTP (Google Authenticator, Authy, etc.), self-service
  enrollment with a QR code, 10 single-use hashed backup codes, under **My Workspace → My
  Security**. Not yet enforced by role — see `docs/data-protection-policy.md` for what's still a
  gap versus what's actually built.
- **Password reset.** `/forgot-password` → emailed single-use link (30-minute expiry) →
  `/reset-password`. Resets and self-service password changes both invalidate every other signed-in
  session. Email sends via Resend when `RESEND_API_KEY` is set; otherwise the link is logged to the
  server console so local development needs no email account at all.
- **Session revocation.** Every session JWT carries a `sessionVersion`; bumping it (logout
  everywhere, password change, deactivating a user) invalidates every outstanding token instantly,
  without a server-side session store.
- **Error tracking & logging.** Unexpected errors are logged as structured JSON and reported to
  Sentry (inert until `SENTRY_DSN`/`NEXT_PUBLIC_SENTRY_DSN` are set) with cookies/auth headers
  stripped before the event ever leaves the process; expected business/permission errors still show
  their real message to the user. A global error boundary replaces Next's default crash screen.
- **CI.** `.github/workflows/ci.yml` runs lint, typecheck, the full test suite, and a production
  build against a real Postgres service on every push/PR.
- **Data protection.** `docs/data-protection-policy.md` — an honest first pass, including the gaps
  that still need a decision (retention schedule, subject-access tooling, breach runbook).

---

## Project layout

```
prisma/schema.prisma            data model (47 tables)
prisma/migrations/              SQL migrations
prisma/seed.ts                  demo data (110 employees, 5 clients, 8 contracts, 20 beats, 3 periods)
src/lib/payroll/                pure calculation engine — engine.ts, structure.ts, paye.ts, formula.ts
src/server/services/            service layer (all business logic, tenancy, RBAC re-checks, audit)
src/app/actions/                server actions (thin wrappers: auth + revalidate)
src/app/(app)/                  pages (dashboard, workforce, clients, operations, payroll, payments,
                                analytics, reports, settings, supervisor, me)
src/app/api/reports/[type]      CSV exports
tests/unit, tests/integration   Vitest (engine + service-level tests incl. the critical end-to-end test)
e2e/                            Playwright browser tests
```

No payroll logic lives in React components — pages call services; the engine is framework-free.

---

## Tests

```bash
npm test            # Vitest: resets + seeds TEST_DATABASE_URL, then runs unit + integration tests
npm run test:e2e    # Playwright: needs the app running on :3000 with demo data (npm run db:seed && npm start)
npm run verify      # lint + typecheck + tests + production build
```

`tests/integration/zz-end-to-end.test.ts` is the **critical end-to-end test**: login → client → contract →
structure → beats → approved strength → employees (auto numbers) → mapping → one employee moved across
four beats → work register per location → overtime → arrears → approved deduction → payroll period → run
→ validate → resolve location exception → PAYE / employee & employer pension → approve → lock → payslip
with all locations → payroll register, pension & PAYE reports → client/beat cost → audit trail.

The spec's 30 numbered test cases are labelled `#1 … #30` in the test names.

First run of Playwright on a new machine: `npx playwright install chromium`.

---

## Notes & next steps

- Payroll month proration uses calendar days (configurable to fixed 30). Monthly PAYE annualises the
  month's regular income; a cumulative (year-to-date) PAYE method is a sensible next enhancement.
- NHF relief exists in the rule engine but is disabled in the seed.
- Future integrations (biometric, GPS, QR, bank APIs, NIBSS/PFA file formats) are out of scope for the MVP.
- Prisma uses the `pg` driver adapter with the query-compiler preview (no native query-engine binary).
  If you prefer the classic engine, remove `previewFeatures`/`engineType` from `schema.prisma` and the
  adapter from `src/lib/db.ts`.
