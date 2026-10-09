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

# 3. Database — either run Postgres yourself and `createdb workforcepay workforcepay_test`,
#    or start it with Docker Compose (restart: unless-stopped, so it survives a Docker restart):
docker compose up -d
docker exec workforcepay-db createdb -U postgres workforcepay
docker exec workforcepay-db createdb -U postgres workforcepay_test

# 4. Run migrations + load demo data
npm run db:setup                 # = prisma migrate deploy && tsx prisma/seed.ts

# 5. Run
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
| Payroll Admin | payroll@demosecurity.test    | structures, inputs, run/recalculate payroll, prepare settlements     |
| Finance       | finance@demosecurity.test    | approve inputs, override criticals, approve & lock payroll, payments, approve & release settlements |
| Operations    | ops@demosecurity.test        | clients, beats, deployment, movements, work register, uniform & kit stock |
| HR Admin      | hr@demosecurity.test         | employee master, overrides, recruitment, contracts, employee relations, exits, HR policy, prepare settlements |
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
- The payslip shows **every location worked** (dates, client, beat, days). It shows only the employee's own
  earnings and deductions: **what the company pays on top (employer pension, ITF, NSITF, insurance and the other
  add-ons) is never on a payslip** — it is reported separately under **Reports → Employer Contributions** (one
  row per employee, a column per head, with totals; filter by client or beat), and each head also keeps its own
  schedule (Pension, ITF, NSITF, …).
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
- **VAT and withholding tax.** Each run's invoices can carry a VAT % (calculated on the indirect / management charge — the 10% of the default 90/10 split — and added to the total, not charged on the whole subtotal) and an
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

### Recurring deductions (Global / Location / Individual)

- **Settings → Recurring Deductions** — deductions applied automatically on every **regular** run
  (never on a supplementary run, so nothing is charged twice within the same period): **Global**
  applies to every paid employee (e.g. a company-wide development levy); **Location** applies to
  everyone who worked at least one day at the chosen beat that period (e.g. site radio rental);
  **Individual** applies to one named employee (e.g. a cooperative contribution). Each is either a
  fixed amount or a percentage of the employee's total earnings for the period, and requires a
  documented reason. Deactivating a rule stops it from the next calculation onward; history already
  paid is untouched.

### Cost centers & budgeting

- **Settings → Cost Centers** — an independent cost-grouping dimension, assignable to departments,
  contracts, and beats, for grouping costs your own way (e.g. by region or business unit)
  independent of the client/contract structure. Each payroll allocation resolves to exactly **one**
  cost center — a beat's own assignment first, then its contract's, then the employee's
  department's — so nothing is ever double-counted; unassigned activity is grouped separately
  rather than silently dropped.
- **Analytics → Cost Center P&L** rolls up revenue, cost and margin by cost center for a selected
  payroll run, alongside that period's budget (Settings → Cost Centers → Set a monthly budget) and
  the variance between them.

### Accounts payable

- **Finance / Accounting → Vendors** — suppliers you owe money to (uniforms/kits, equipment,
  utilities, professional services, rent, maintenance), with bank details for payment.
- **Finance / Accounting → Billing & Payables** — the mirror image of Billing & Receivables, for
  money going out: record a vendor bill with line items and VAT (auto-numbered `PINV-######`,
  optionally tagged with a cost center), then track cash payments (`VendorPayment`) and non-cash
  deductions (`PurchaseInvoiceDeduction` — e.g. withholding tax we're required to remit on the
  vendor's behalf — always with a reason and a supporting document reference) against it. A bill
  moves RECORDED → PARTIALLY_PAID → PAID as payments/deductions cover the total; a clean bill with
  neither can be cancelled, one with either cannot. The payables summary totals billed / paid /
  deducted / outstanding / overdue by vendor, same shape as the receivables summary.

### Purchase orders

- **Finance / Accounting → Purchase Orders** — raised before a vendor bill exists: request an order
  (auto-numbered `PO-######`, vendor + line items + VAT, shared vendor/cost-center list with
  Billing & Payables) → submit for approval → an approver (`payment.manage`, same permission as the
  requester — this app has no separate maker-checker role split) approves or rejects it with a
  reason → once **APPROVED**, convert it to a `PurchaseInvoice` when the bill actually arrives,
  carrying over vendor, cost center, lines and VAT automatically. A converted order is terminal (no
  re-cancelling); a draft or approved order not yet converted can still be cancelled with a reason.

### Fixed asset register

- **Finance / Accounting → Fixed Asset Register** — company-owned capital assets: vehicles, radios,
  CCTV, firearms, office/IT equipment, furniture. Each is auto-numbered `FA-######`, optionally
  tagged with a cost center and/or assigned to an employee, and carries cost, salvage value and
  useful life (months).
- **Depreciation is straight-line and computed on the fly** — never stored as a running schedule, so
  there's nothing to re-run when a rate or "as of" date changes. Whole calendar months only (the
  acquisition month counts as month 1; day-of-month is ignored), capped at the useful life.
- **Disposal** is terminal (no re-activation): records a disposal date, proceeds and a reason;
  depreciation freezes at the disposal date, and the detail page shows the resulting gain/(loss).

### Currency

- **Settings → Organization → Currency** — an organization-level setting (`NGN`, `USD`, `GBP`,
  `EUR`, `GHS`, `KES`, `ZAR`), backed by a registry in `src/lib/money.ts` (locale + symbol per
  code) rather than a hardcoded `₦`/`NGN` in the formatter.
- This is display-only readiness, not multi-currency support: amounts aren't converted, most
  screens still call the NGN-defaulted `naira()`/`compactNaira()` helpers, and nothing threads an
  organization's chosen currency through yet. `formatMoney(v, code)` / `compactMoney(v, code)` are
  the currency-aware building blocks a future multi-currency UI would call instead.

### Bank reconciliation (operating account)

- **Finance / Accounting → Bank Accounts** — the organization's own operating account(s), with an
  opening balance/date and an optional link to a GL account. Distinct from the payroll-disbursement
  reconciliation under Payroll → Bank Reconciliation, which only matches the bank statement against
  employee payment transactions.
- **Finance / Accounting → Bank Reconciliation** — import a bank statement (CSV:
  `date,description,amount,reference`; positive = money in, negative = money out). Each line is
  auto-matched against an existing client receipt or vendor payment by amount (±1 kobo) and date
  (within 5 days) — only when **exactly one** candidate qualifies; an ambiguous amount is left for
  manual review rather than guessed. Leftover lines can be matched by hand to a specific receipt/
  payment, or marked as a bank-only item (charges, interest, transfers) with a required note.
- The page shows a textbook reconciliation statement: balance per bank statement and balance per
  books, each adjusted for what the other side hasn't caught up to yet (deposits/payments in
  transit on the book side; bank-only items not yet recorded on the book side) — the two adjusted
  balances should match once every line is accounted for.
- Scoped to a single primary operating account for now: receipts and payments aren't tied to a
  specific bank account, so matching draws from the org-wide, not-yet-matched pool (a record can
  only ever be claimed by one statement line).

### Financial statements

- **Finance / Accounting → Trial Balance / Income Statement / Balance Sheet** — fully GL-sourced.
  Every figure is summed straight from `JournalLine` debits/credits grouped by GL account, the same
  ledger payroll locks post to. Client billing, vendor billing, bank account openings and
  fixed-asset acquisition/disposal/depreciation all post their own journal entries too
  (`src/server/services/gl-posting.ts`), so nothing here is computed from a side table anymore.
- Because every `JournalEntry` posts equal debits and credits, the fundamental accounting identity
  (Assets = Liabilities + Equity + Income − Expense) holds exactly across the whole ledger once
  account-type balances are summed — verified by the balance-sheet always balancing to the kobo,
  not approximately.
- **Trial Balance** is every GL account's debit/credit activity as of a date; **Income Statement**
  is INCOME/EXPENSE account balances for a period, split into revenue and expense rows; **Balance
  Sheet** groups ASSET/LIABILITY/EQUITY balances as of a date, with named rows for the accounts
  every screen posts to (cash, AR, AP, fixed assets/accumulated depreciation, opening balance
  equity) and catch-all rows for any other account in that type so nothing is silently dropped.
- **Equity is genuinely derived, not a plug**: Opening Balance Equity (from bank-account openings)
  plus Retained Earnings (the ledger's own cumulative Income − Expense to the cutoff date), both
  summed from `JournalLine` like everything else.
- **What posts where**: client invoices/receipts/deductions post to AR (`billing.ts`); vendor
  invoices/payments/deductions post to AP (`payables.ts`); opening a bank account posts Opening
  Balance Equity (`bank-reconciliation.ts`); creating/disposing a fixed asset posts its cost/gain-
  loss (`fixed-assets.ts`); and **Fixed Asset Register → Post depreciation for a month** posts one
  journal per calendar month for every asset's incremental depreciation that month, blocked from
  running twice for the same month.
- **Known simplifications** (see `gl-posting.ts`'s header comment): all AP spend posts to one
  generic expense account regardless of vendor category, VAT on a purchase is folded into that
  expense rather than tracked as input VAT, and AR/AP cash movements post to one default operating-
  cash account rather than a specific `BankAccount`. There's also no link between a vendor-billed
  purchase and a fixed-asset registration, so an asset bought via Payables and then separately
  entered in the Fixed Asset Register posts its cost twice (accepted simplification, not a bug) —
  a future phase could add that link.
- The Fixed Asset Register's own net-book-value column stays a live, on-the-fly calculation from
  the asset's own fields (unchanged from before) — it can differ from the Balance Sheet's GL-posted
  net book value until "Post depreciation for a month" has actually been run for a given month.

### HR lifecycle (hire to retire)

One connected employee record from the day a role is requested to the day the final settlement is paid.
Nothing about the process is hard-coded to one company — the policy numbers and the onboarding / exit
checklists are settings (see **Configuring it for a buyer** below), so a different buyer's process is a
settings change, not a code change. **HR Lifecycle → HR Overview** shows everything needing attention.

- **Recruitment** (HR Lifecycle → Job Requisitions / Candidates & Pipeline).
  A requisition (`REQ-#####`: role, category, department, positions, budget) must be approved by
  someone **other than the requester**. Candidates (`CAN-######`) can only be added to an approved
  requisition, and the same phone/email can't be entered twice into one requisition. Candidates move
  through screening → interview → assessment → offer; interviews carry a 1–5 scorecard and a hire /
  no-hire recommendation, and a candidate can't reach the offer stage without a completed interview.
  **Vetting** (reference, ID, police clearance, guarantor, medical…) must be cleared — or waived with a
  reason — before a hire. Offers (`OFR-#####`) are also maker/checker, then sent, then accepted or
  declined, and expire after the policy's validity window. **Hiring** creates the employee, their
  employment contract, a personal pay rate (optional — guards are normally paid from the client
  contract's rates) and the onboarding checklist in **one transaction**. It refuses a person who is
  already on staff with the same phone/email, or whose previous exit was flagged *not eligible for
  rehire*, and it closes the requisition when its headcount is filled.
- **Onboarding** (Onboarding Tracker). The onboarding template is stamped onto every new hire — due
  dates counted from the start date, a responsible role per step, required vs optional, and steps that
  apply to one employee category only. The tracker lists everyone with open steps, most overdue first;
  a step that doesn't apply is waived with a reason.
- **Employment contracts** (Employment Contracts). The employee's own terms (`EC-######`), separate
  from the client service contracts: permanent, fixed-term, probation, casual, consultant or
  internship, each with its own rules (e.g. fixed-term needs an end date, permanent has none). One is
  active at a time; **renewals** and **probation confirmations** supersede the old one and link back, so
  history is never lost. Probation is tracked with an outcome — *confirm* (converting a probationary
  contract to permanent), *extend* (capped by the policy's longest probation) or *fail* (HR then starts
  an exit). The **Alerts & gaps** tab lists contracts ending soon or already past their end date,
  probation reviews due or overdue, and staff with no contract on file. The contract's notice period
  is what an exit uses.
- **Employee relations** (Employee Relations; employees use **My Workspace → My Grievances**).
  Grievances, misconduct investigations, harassment and whistleblowing concerns, counselling and
  mediation are *cases* (`ER-#####`) with a resolution target from the policy. Employees can raise
  their own grievance / harassment / whistleblowing concern; harassment and whistleblowing cases are
  **always confidential** — read-only viewers (e.g. an auditor) see that the case exists but never its
  contents, and an employee sees only the status and outcome of their own cases. The **case file is
  append-only** (notes, evidence, hearings, decisions can't be edited or deleted). A case moves open →
  investigating → hearing → resolved → closed (closing needs a second person with `hr.approve`) and can
  be re-opened on appeal. A substantiated finding can raise a **sanction**, which still goes through the
  existing disciplinary maker/checker and is linked back to the case; an employee's own grievance can't
  be turned into a sanction against them.
- **Exit & clearance** (Exits & Clearance; start an exit from the employee's *Onboarding & exit* tab).
  The existing exit workflow now records a **reason category** (better pay, redundancy, misconduct…,
  for attrition reporting), a **summary-dismissal** flag (terminations only), and freezes the **notice
  period owed** at initiation (the contract's term, else the policy default) so a later policy edit
  can't rewrite a settlement already in progress. Approving an exit ends the active contract, cancels
  any leave request still awaiting a decision and stamps the clearance checklist. HR records the **exit
  interview** and an *eligible for rehire* flag (which Recruitment enforces). The exit page lists the
  **company assets still assigned** to the leaver from the Fixed Asset Register.
- **Attrition report** (HR Lifecycle → Attrition Report). From approved exits in a chosen period:
  leavers, **turnover rate** (leavers ÷ average of opening and closing headcount, with an annualised
  figure), voluntary vs involuntary, leavers who left **within a year of joining**, those flagged not
  eligible for rehire, average service, and breakdowns by reason, exit type, length of service, category,
  department and month. It is only as good as the reason category recorded at exit — unrecorded ones show
  as "Not recorded".
- **End-of-service settlement** (Payroll → End-of-Service Settlements, `EOS-#####`). For an approved
  exit it works out, from the HR policy, what is owed **on top of the final month's pay** (payroll
  already pays the days worked up to the last day): *unused leave* — what is left of the current leave
  year plus what has accrued toward the next, paid at a day rate of monthly pay ÷ the policy's divisor;
  *gratuity* — days of pay per completed year (optionally pro-rating a part-year) once the minimum
  service is met; *severance* on a redundancy; and *notice* — pay in lieu when the employer ends
  employment short of notice, or a recovery when the employee leaves short of notice. A summary
  dismissal forfeits notice pay, gratuity and severance. Monthly pay is taken from the latest payroll's
  contractual gross, else the personal pay rate, else entered manually. HR/payroll can add **manual
  lines** (loan balance, unreturned property, ex-gratia). Every settlement stores its workings and the
  rules it applied.
  Workflow: *draft → submitted → approved → released*. The **approver must be a different person** from
  the preparer, and every *required* clearance step marked "blocks settlement" must be done (or waived)
  first. **Release** doesn't pay anyone directly: it creates approved earnings and deductions in the
  payroll period containing the last working day, so PAYE, pension, the payslip, payment batches and GL
  posting all happen in the normal payroll run — or a **supplementary run** if that period is already
  locked. (A period that is approved but not yet locked blocks release until it is locked.) A released
  settlement is corrected with a normal payroll adjustment, not edited. Each payment carries a
  **taxable** flag; lump sums are *irregular* income in the PAYE engine (added once, not annualised).

**Configuring it for a buyer**

| Where | What it controls |
| ----- | ---------------- |
| Settings → HR & Lifecycle Policy → *Employment terms & alerts* | default and longest probation, default notice period, retirement age, how early contract / probation alerts fire, offer validity, employee-relations target days, and the days-in-a-month divisor behind every day rate |
| …→ *Unused leave* | on/off, paid at gross or basic, maximum days, whether the leave policy's service period must be complete, taxable, and which exit types it applies to |
| …→ *Gratuity* | **off by default** (jurisdiction-specific) — basis, completed years needed, days of pay per year, part-year pro-rating, taxable, which exit types |
| …→ *Severance & notice* | redundancy severance, pay in lieu of notice, recovery of a notice shortfall, each with its taxable flag |
| Settings → Onboarding & Exit Checklists | add, edit, reorder, switch off or remove steps; due offsets, responsible role, required vs optional, "blocks settlement", per-category steps |
| Settings → Numbering Rules | the `REQ`, `CAN`, `OFR`, `EC`, `ER` and `EOS` number formats |
| Roles | `hr.configure` (policy & checklists), `settlement.manage` (prepare), `settlement.approve` (approve & release), `relations.raise` (employee self-service), plus the existing `hr.view / hr.manage / hr.approve` |

Changes apply **going forward**: contracts, offers, exits and settlements already created keep the
values they were created with. Tax treatment of end-of-service payments differs by country — every
payment has its own taxable flag and defaults to taxable; confirm the right treatment before relying
on a setting.

### HR reminder email

A **daily digest** so the alerts don't depend on someone opening the dashboard. It lists, for the
organization: approvals waiting (requisitions, offers, exits, disciplinary records, settlements,
loans), settlements approved but not yet released, contracts ending or past their end date, probation
reviews due or overdue, staff with no contract, overdue onboarding steps, employee-relations cases
past (or within three days of) their target, leavers still holding kit or owing a loan, and documents
expiring within 30 days, required training that is expired or missing and certificates expiring soon, guarantors waiting to be verified, and staff whose personal records are incomplete
(no next of kin, no emergency contact, short of verified guarantors — new joiners get 30 days first).
Every item links back into the app; a confidential case shows only that it
exists.

- It goes to every **active HR admin** plus any extra addresses (**Settings → HR & Lifecycle Policy →
  Reminder email**, which also switches it off), **at most once a day**, and **never when there is
  nothing to report**. One address failing doesn't stop the rest.
- **HR Lifecycle → HR Overview** shows what the email would say today and has **Send now** (which ignores
  the once-a-day rule but still won't send an empty one).
- It is sent by a scheduler calling `GET /api/cron/hr-digest` with `Authorization: Bearer <CRON_SECRET>`
  (the form Vercel Cron sends). **Set `CRON_SECRET`** — with none set the endpoint is switched off, not
  left open — and set `RESEND_API_KEY` / `EMAIL_FROM` / `APP_URL` so mail actually goes out (without a
  key it is only written to the server log). Examples:
  - Vercel: `vercel.json` → `{"crons":[{"path":"/api/cron/hr-digest","schedule":"0 6 * * *"}]}` (06:00 UTC).
  - Any server: `0 6 * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://your-app/api/cron/hr-digest`
  - Windows Task Scheduler: a daily task running
    `curl.exe -fsS -H "Authorization: Bearer <secret>" https://your-app/api/cron/hr-digest`.

  The job covers every organization in turn, so one schedule serves all tenants.

### Candidate data retention

Privacy laws (Nigeria's NDPA, GDPR and similar) limit how long you may keep an applicant's personal
details. **Settings → HR & Lifecycle Policy → Data retention** sets how many months a *rejected or
withdrawn* candidate is kept (default 24; **0 keeps everything**).

- Past that, the candidate's **name, phone, email, CV reference, notes, rejection reason, interview comments
  and vetting notes are removed** and the record is marked anonymised. The candidate number, requisition,
  stage reached, interview scores and offer figures stay, so recruitment funnels and time-to-hire reports
  keep working.
- **Never touched:** anyone still in the pipeline (however long they've sat there), and hired candidates
  (they are employees now — their data follows the employee record).
- Each run is written to the audit log as *System (data retention)*. Removal is permanent.
- It runs daily from `GET /api/cron/data-retention` with `Authorization: Bearer <CRON_SECRET>` — same secret,
  same switched-off-without-it behaviour and scheduler examples as the HR digest above. The settings page
  shows how many candidates are past the limit and has **Run retention now** (needs `hr.configure`).

### Staff loans & advances

**Payroll → Staff Loans & Advances.** Interest-free money lent to an employee and repaid from payroll —
tracked as a ledger instead of one-off deductions with nobody watching the balance.

- **Request → approve → pay out.** A loan (`LN-#####`, repaid over up to 60 months) or a salary advance
  (always one repayment) is requested by HR/payroll and approved by **someone else** (`loan.approve`).
  Approving it is the authority to pay out and posts the GL (Dr Staff Loans & Advances / Cr Cash), so
  outstanding loans show as an asset on the balance sheet.
- **Affordability limits** from Settings → HR & Lifecycle Policy → *Staff loans & advances*: a loan up to
  N× monthly gross (counting what's already owed), monthly repayments up to X% of gross across all of an
  employee's loans, and an advance up to Y% of gross (0 = no limit). Gross comes from the latest payroll,
  else the personal pay rate — so a new joiner can borrow after their first payroll.
- **Repayment through payroll.** *Schedule repayments* adds each active loan's next instalment to an open
  payroll period as an approved LOAN / SALARY_ADVANCE deduction, so the **existing payroll run takes it** —
  no engine change — and the existing GL mapping credits the staff-loans account. It's safe to run twice,
  and a rejected deduction frees that amount to be scheduled again. A repayment counts as **repaid once
  that payroll is locked**; until then it shows as *queued in payroll*. The balance is never stored — it
  is worked out from the instalments.
- **Cash repayments** can be recorded (Dr Cash / Cr Staff Loans) up to what isn't already queued in payroll.
  **Write-off** needs a reason, a second person and nothing queued (Dr Staff Loan Write-off / Cr Staff Loans).
- **At exit**, the exit page shows what the leaver still owes, and on the settlement page one click adds the
  part not already queued as a recovery per loan; on release it becomes a deduction recorded against the loan.
- Roles: `loan.manage` (HR, payroll), `loan.approve` (finance, admins). Viewing needs `payroll.view`.

### Uniform & kit stock

**Operations → Stock & Kit / Kit Packs / Kit Held by Staff.** A stock ledger for uniform, footwear,
accessories and equipment, tied to the people who are issued it.

- **Stock items** (`ITM-#####`) — one line per size ("Shirt — L"). Every unit that is received, issued,
  returned, adjusted or written off is a **ledger entry**; the shelf count and the **weighted-average
  cost** are updated with it in the same transaction. Stock can't go below zero, a reorder level flags low
  stock, and a **stocktake** (set the shelf to what was counted) records the difference with a mandatory
  reason rather than overwriting it.
- **Issuing** — kit goes to an employee who is still employed; the item must be switched on and in stock.
  A **kit pack** (e.g. "Guard starter kit") issues all of its items at once — **all or nothing**, so a
  shortage of one item never leaves a half-issued kit.
- **Returns** — an employee can only give back what they hold (also after they've left). Only kit returned
  in **good** condition goes back on the shelf; **damaged** or **lost** kit is recorded with a reason and
  written off.
- **Kit held by staff** lists everything out, people who have already left first, with its value. The exit
  page shows the same, and on the settlement page one click adds the value as a **recovery** line (once,
  while the settlement is a draft). The employee record has a **Kit & uniform** tab to issue, take back and
  see what they hold.
- Roles: `inventory.view` (HR, operations, payroll, finance, auditor) and `inventory.manage` (operations
  and HR). Stock isn't posted to the GL yet — see next steps.

### Personal records: next of kin, guarantors, dependants

**Employees → Next of Kin & Emergency / Guarantors / Dependants & Beneficiaries**, and an employee's
**Contacts & guarantors** tab, hold the people connected to each employee. Needs `employee.sensitive` to
view and `hr.manage` to change.

- **Next of kin, emergency contacts, dependants, referees.** Phone is required for everyone but a
  dependant (whose date of birth is). The first next of kin / emergency contact becomes the **main** one;
  there is only ever one main per kind, and removing it promotes the next. Next of kin and dependants can be
  **beneficiaries** with a percentage — shares can't exceed 100% and the pages flag a split that isn't 100%.
- **Employees keep their own** under **My Contacts** (self-service). They can never see or touch anyone
  else's, and guarantors are HR's alone.
- **Guarantors** are recorded *pending* and then **verified** (an ID type/number and the signed-form
  reference must be on file, and the verifier says how they checked) or **rejected**; a verified guarantor
  is **released**, never deleted, when no longer needed. Rules enforced when one is recorded: the
  guarantor's phone can't be the employee's own, the same person can't be added twice for one employee,
  and one person can guarantee only so many staff at once (matched by phone *or* ID, however the number is
  written). **Changing a verified guarantor's name, phone, address, ID or form sends them back to pending.**
  Guarantors stay on file after the employee leaves (they may be needed to recover what's owed).
- **Policy** (Settings → HR & Lifecycle Policy → *Personal records*): how many next of kin, emergency
  contacts and verified guarantors are required (0 = not required), **which categories need guarantors**
  (none ticked = everyone), the per-person guarantee limit, and whether someone other than the recorder must
  verify. Each page counts and lists whoever is short; pending guarantors don't satisfy the requirement.
- **At exit**, the settlement page lists the leaver's guarantors with their phones, addresses and any
  capped amount — and says plainly when something is owed (a negative settlement, a loan balance or kit not
  returned), since that's when a guarantor may be called on. **Release these guarantors** lets them go in one
  step, but only once employment has ended and nothing is owed; otherwise release them one by one with a reason.
- Every add, edit, verification and release is in the audit log. Leavers' contact records are frozen.

### Training compliance

**Settings → Training Requirements** says which courses and certifications staff must hold; **HR → Training
Compliance** shows who is missing or expired. Certificates are still recorded on the employee (Documents &
training tab) — this adds the question "who *should* have what".

- **Requirements** are per course name, for **everyone or one category** (e.g. a firearms licence for armed
  guards only), each with a **new-joiner grace period** (default 30 days from the employment date) before a
  missing certificate counts. Switch one off and it stops counting against anyone; the page refuses duplicates
  and a category requirement for a course already required of everyone.
- **Nothing is stored as a status** — it is worked out from the certificates and today's date, so it can't go
  stale. An employee is **Valid**, **Expiring soon** (inside the policy's alert window, default 60 days; 0 =
  only flag once expired), **Expired**, **Missing**, or **Due (new joiner)** while still in grace. Only expired
  and missing count against an employee.
- **Matching:** a certificate covers a requirement when the course name matches (case and extra spaces don't
  matter), it isn't revoked, and it hasn't lapsed. If several are on file, the longest-lasting decides — so
  recording a renewal clears an old expired one; a certificate with no expiry date never lapses.
- **Where it shows:** the compliance page (totals, by-requirement table, and a filterable list of who needs
  attention), a *Required training* panel on each employee's Documents & training tab, and two HR-digest
  sections (expired/missing, and expiring soon). Leavers aren't measured.

### Performance appraisals

**HR Lifecycle → Appraisals** runs review cycles; **My Appraisals** is where employees, reviewers and
approvers do their part.

- **Cycles.** Launch an annual, probation or ad-hoc cycle for everyone, one category, or specific people
  (specific people are included whatever their service). One appraisal is created per eligible employee, with
  the criteria and weights *copied at launch* — changing them later never alters a review in progress. The
  reviewer defaults to the employee's reporting manager if that person has a login that can review; otherwise
  HR assigns one. Staff under the policy's minimum service at the period end are skipped and listed.
- **Criteria** (Settings → Appraisal Criteria): add, reweight, describe or switch off what people are rated on.
  Weights are relative. Starter criteria: job knowledge, quality of work, attendance, discipline & integrity,
  teamwork, initiative. The 1–5 scale (Unsatisfactory … Outstanding) is fixed; the overall score is the
  weighted average, with the band it falls in.
- **The flow.** The employee rates themselves (optional — a policy switch) → the assigned reviewer rates every
  criterion, saving drafts, then submits → **someone other than the reviewer signs it off** (or returns it with
  a note) → the employee reads the result and **agrees, or disagrees with a reason**, which is kept on the
  record. A very low or very high rating needs a comment (thresholds are in the policy; 0 switches a side off).
- **Confidentiality.** Until sign-off the employee sees only their own self-assessment — not the reviewer's
  ratings, comments or score — and that holds even for an HR admin looking at their *own* appraisal. Nobody can
  review, approve or return their own. Only the reviewer sees a draft; HR and auditors see everything.
- **Visibility for HR.** Cycle pages show progress, average score, the spread across bands, unassigned
  reviewers and disputes; each employee has an **Appraisals** tab with their history. The HR digest lists
  overdue reviews and appraisals awaiting sign-off. Every step is in the audit log.
- **Probation.** On a contract whose probation is under review, **Start a probation appraisal** creates a
  one-person review over the probation period (reviewer = the employee's manager if they can review), named
  after the employee and contract, with further rounds after an extension. The contract page shows where it
  stands and what it recommends, and the HR digest's probation line says whether the appraisal is in
  progress, awaiting sign-off or signed off. With **Settings → HR & Lifecycle Policy → Performance
  appraisals → "Probation can be confirmed only after a signed-off probation appraisal"** on (off by default),
  *confirming* probation is refused until the newest probation appraisal covering that probation is signed
  off — and, if you set a minimum score, scored at least that. Extending or failing probation is never blocked.
- Permissions: `appraisal.view`, `appraisal.manage` (cycles, criteria, assignments), `appraisal.review`
  (supervisors and HR), `appraisal.approve` (HR, company admin).

### Change control for bank, tax and pension details

Quietly changing someone's bank account is the classic payroll fraud. With **Settings → HR & Lifecycle Policy →
Change control** on (the default), an employee's **bank, tax and pension details can't be edited directly** —
the employee form refuses, and a change is *requested* and takes effect only when someone else approves it.

- **Requesting.** HR (or anyone with `employee.manage`) from the employee's **Bank, tax & pension** tab, or the
  employee themselves for their own details under **My Bank & Tax Details**. A reason is required; the form
  validates (10-digit NUBAN, etc.) and refuses a request that changes nothing or duplicates one already pending.
- **Approving** (`employee.approve`: HR admins, Finance, company admins) from **Employees → Detail Change
  Requests** or the employee's tab. The approver sees *what is on file → what is asked for*, the reason, and two
  checks: **does the account name look like the employee's** (first and last name both present, any order), and
  **does anyone else already hold that account number / tax ID / PIN** — if so approval is refused. **The
  requester can never approve their own request, and an employee can never approve changes to their own
  details**, whatever permissions they hold. A request is also refused if the employee's details changed after
  it was made, or they've left.
- **Payroll watches the result.** For *N* days after an approved bank change (policy, default 30; 0 = off),
  payroll validation raises a warning — "bank details changed on …, requested by …, approved by … — confirm with
  the employee before paying" — for that employee only. It's a warning, not a blocker.
- Every request, approval, rejection and cancellation is audited, and an approved change is also logged under
  the long-standing `BANK_/TAX_/PENSION_INFORMATION_CHANGE` actions. The HR digest lists requests waiting.
- Switch change control off in the policy and these fields can again be edited directly (still audited).

### Company policies & acknowledgements

**HR Lifecycle → Policies & Acknowledgements** publishes the policies staff must read (code of conduct, data
protection, safety…) and shows who has acknowledged them; employees do it under **My Policies**.

- **Publish** a policy to everyone or one category, with its text, a document reference, or both, an effective
  date (a future date schedules it) and a grace period for acknowledging (default 14 days). Needs `hr.configure`.
- **Versions are never edited.** A change is a new version with a note of what changed, and **everyone it
  applies to is asked again**. A scheduled version waits for its date; until then the previous version stays
  current and nobody is chased early. Old acknowledgements are kept.
- **Acknowledging.** The employee reads the current text and confirms. Where staff sign on paper instead, HR
  records it against the employee with a reference to the signed sheet (shown as a paper sign-off) — and can
  never record one for themselves. An employee can acknowledge only a policy that applies to their category.
- **Due and overdue.** The grace period runs from the *later* of the version taking effect and the employee
  joining, so a new hire isn't chased for a policy that started years ago and nobody is chased the day a new
  version appears. The due day itself still counts as pending.
- **Seeing it.** The policy page lists who still has to (overdue first) with a button for the paper sign-off;
  the list shows acknowledged x/y and overdue per policy; each employee's Documents & training tab shows theirs;
  and the HR digest lists policies with overdue acknowledgements. Archive a policy and nobody is asked for it.
  Leavers aren't counted. Every publish, acknowledgement and archive is in the audit log.

### HR reports & safe exports

The **Reports hub** has an **HR Lifecycle** group of downloadable reports (each can be printed or downloaded
as CSV, and every download is audited):

| Report | Shows | Needs |
| --- | --- | --- |
| Employee Register | every current employee: category, department, age, service, contract, probation | `hr.view` |
| Training Compliance | each required course per employee — expired and missing first | `hr.view` |
| Policy Acknowledgements | who has / hasn't acknowledged each active policy — overdue first | `hr.view` |
| Appraisal Results | every appraisal; **scores appear only once signed off** (optionally one cycle: `?cycleId=`) | `appraisal.view` |
| Guarantor Register | every guarantor with verification status (including released) | `employee.sensitive` |
| Personal Records Completeness | next of kin, emergency contacts and guarantors vs the policy — incomplete first | `employee.sensitive` |
| Bank, Tax & Pension Change Log | who asked to change what and who decided — **names the fields, never the values** | `employee.sensitive` |

Each report is opened by the permission that guards the underlying records, not just `reports.view`, so a
download can never reach more than the same person could see on screen (the hub also hides what you can't open).

**CSV exports are safe to open in a spreadsheet.** A cell beginning `=`, `+`, `-` or `@` (or a tab/return) is
run as a formula by Excel and Sheets, so text someone typed — an account name, a guarantor, a reason — could
carry a payload to whoever downloads the report. Such text is now written with a leading apostrophe, which
spreadsheets show as plain text; numbers the app computed (including negative ones) are left alone. This
applies to **every** report, not just the new ones.

### Data access requests (right of access)

The NDPA and GDPR give people the right to a copy of the personal data a company holds on them.
**HR Lifecycle → Data Access Requests** runs that process, and **My Data** lets employees help themselves.

- **The register.** Log a request (employee or former employee, who asked, how it arrived, the date it was
  received) and it gets a number (`DSR-#####`) and a deadline — **Settings → HR & Lifecycle Policy → Privacy**,
  default 30 days from receipt (1–90). The list shows open, due-within-7-days and overdue, and the
  HR digest flags the late ones. Needs `hr.manage` to act, `hr.view` to see.
- **The steps.** *Check identity* (a note of how is required) → *Generate & download data* → *Complete*; or
  *Refuse* with a written reason. The export can't be generated before identity is recorded, and a request
  can't be completed before it has been generated. Every step is audited.
- **The file** is JSON built at the moment of the request and **never stored**; the register keeps only a
  SHA-256 checksum and how many records each section held, as evidence of what was handed over. It covers
  profile (incl. bank, tax and pension details), contracts, onboarding, postings, an attendance summary,
  payslips, loans, leave, training and documents, signed-off appraisals, approved disciplinary records and
  non-confidential cases, the people they told us about, policies acknowledged, letters issued, requests to
  change their details, exit and settlement, kit still held, and their job application. Generating it needs
  `employee.sensitive` as well, because it includes bank details.
- **What it leaves out, and says so in the file:** interviewers' free-text feedback; confidential investigation
  records (it states that some exist); other people's details — a guarantor or referee shows only name,
  relationship and status, never their phone, address or ID; unsigned or pending records; and system logs.
  A colleague's data never appears.
- **My Data.** An employee can download their own data at any time (`/api/me/data-export`) with no request;
  it only ever returns the signed-in employee's record, and every download is audited.

### Data breaches

A personal-data breach that is likely to put people at risk has to be reported to the regulator within a set
time of the company becoming aware of it (72 hours under the NDPA/GDPR). **HR Lifecycle → Data Breaches** is the
register, and it runs that clock.

- **Log it** (`hr.manage`) with a number (`BRC-#####`), what happened, **when the company became aware** — the
  deadline counts from there — the kinds of data involved and roughly how many people. The deadline is
  **Settings → HR & Lifecycle Policy → Privacy** (default 72 hours, 1–720).
- **The clock never waits for an assessment.** A breach nobody has assessed is treated as one that may need
  reporting, so it shows *due soon* in the last 24 hours and *overdue* after the deadline. The HR digest email
  lists breaches that are unassessed, due soon or overdue.
- **Assess it** (`hr.approve`, with a written reason of 15+ characters): *unlikely to harm anyone* (nothing to
  report — still kept in the register), *likely to put people at risk* (tell the regulator) or *high risk*
  (tell the people affected too). It can't be downgraded to "no risk" once the regulator has been told.
- **Tell the regulator** — record when and their reference. The time can't be in the future or before the company
  knew, and after the deadline **the reason for the delay is required**. The page assembles the facts a notice
  asks for (what, when, what data, how many people, the risk, containment, contact).
- **Tell the people affected** (high risk only) — record how and what they were told.
- **Close it** (`hr.approve`) only when assessed, contained (how and when), the cause and the fix are recorded,
  the regulator has been told if that was required, and the people affected too if that was. A closed breach is
  read-only.
- **Everything is on a timeline** (append-only, who and when) and in the audit trail. State — on time, late,
  overdue — is always worked out from the facts, never stored.
- **Who to call.** **Settings → HR & Lifecycle Policy → Data protection contact and breach procedure**
  (`hr.configure`) holds the named contact (name, email, out-of-hours phone), the regulator's name (default
  Nigeria Data Protection Commission) and how to reach it, and the company's own procedure in its own words.
  They show on every breach page, and the named contact goes into the notice facts. **Until a name or email is
  entered, the breach pages show a warning** that nobody is named. The system can't fill these in for you — see
  `docs/data-protection-policy.md` §8.

### Records retention (former employees)

A former employee's records have to be kept for a legal minimum (tax and pension rules) and no longer than
needed. **HR Lifecycle → Records Retention** handles the end of that.

- **Off until you set it.** **Settings → HR & Lifecycle Policy → Data retention → Keep former employees'
  records for (years)**. The default is **0 = off**: nothing can be erased and the page says so. The system
  doesn't choose the period — confirm yours (6 years is commonly cited for tax records; pension records can be
  longer, so use the longer).
- **Before the period is over, nothing can be erased** — not at the person's request either. After it, a person is
  eligible when they have left, have an exit date, and **nothing is outstanding**: no staff loan owed, no
  settlement not yet released, no open employee-relations case, no open data access request, and no other erasure
  request waiting. The page lists leavers past the period with whatever blocks each one.
- **Two people.** HR asks (`hr.manage`, with a reason of 15+ characters) — either from the "past the period"
  list or for a former employee who has asked. A **different** person with `hr.approve` approves or turns it down
  (a reason is needed to turn down). Approving re-checks everything and carries the removal out in one
  transaction. The person who asked can't approve it.
- **What goes:** name, date of birth, phone, email, address, bank, tax and pension details; next of kin and
  guarantors; the text of documents, letters, disciplinary and exit records, case notes and appraisal comments;
  change-request details; any job application; their login (closed, renamed, password unusable).
  **What stays:** employee number, dates, category, and every pay and leave figure. The **audit trail is kept** as
  it is. The request keeps a count of what was removed, never the data. It can't be undone.
- The HR digest lists erasure requests waiting for approval and leavers who are past the period with nothing in
  the way. Nothing runs automatically.

### Ledger integrity, backups and restore rehearsal

Before the finance module is extended, there is a safety net under the books (see `docs/finance-architecture.md`).

- **`npm run ledger:check`** reads every organization and reports, without changing anything: every journal
  balances and its header equals its lines; no line is negative or both-sided; every journal has at least two
  lines; every line's account belongs to the same organization; the whole ledger's debits equal its credits;
  every locked payroll run has its journal; and the **receivables and payables subledgers equal their ledger
  control accounts** (1200 and 2180). Journal-number gaps are warnings (a ledger that never deletes has none).
  It exits 1 on any error, runs in CI on the seeded database, and should be run before and after every finance
  migration. It reads in one consistent snapshot, so a posting that commits while it runs can't make it disagree
  with itself.
- **`npm run db:backup`** writes `backups/<database>-<timestamp>.dump` (PostgreSQL custom format) using the local
  `pg_dump` or, if that isn't installed, the one inside the database's Docker container (`WFP_DB_CONTAINER`,
  default `workforcepay-db`). The folder is git-ignored: a dump holds personal and payroll data, so keep it
  somewhere access-controlled.
- **`npm run db:restore-check -- <file>`** proves a backup works: it restores into a scratch database, runs the
  integrity check there, compares row counts and findings with the live database, and drops the scratch database.
  It never writes to the live database. CI does a backup-and-restore rehearsal on every run. Restoring for real is
  a deliberate act into an empty database (`createdb <name> && pg_restore --no-owner -d <name> <file>`).
- **Cancelling a client invoice or a vendor bill now reverses its ledger posting** (a journal dated the day of the
  cancellation, beside the untouched original). Before, only the status changed, so a cancelled invoice's
  receivable and revenue stayed in the ledger and the receivables subledger no longer matched it. Documents
  cancelled before this change still carry that error; the check reports them.

### Accounting periods and the posting engine

Phase 1 of the finance plan (`docs/finance-architecture.md`) starts with the control points every later feature
depends on.

- **One posting function.** Every journal — payroll, client and vendor billing, receipts, deductions, cancellations,
  depreciation, loans, bank openings — is written by `src/server/services/posting.ts`. It refuses a journal with
  fewer than two lines, a negative or two-sided line, an unbalanced total, an account that doesn't exist, belongs to
  another organization or is inactive, or a date in a period that is closed. It numbers the journal, records the
  period and **the document it came from** (`sourceType` / `sourceId`, e.g. `CLIENT_INVOICE` and the invoice's id)
  and writes the audit entry, all in the caller's transaction, so a document and its journal commit or fail together.
- **Accounting periods** (Finance / Accounting → **Accounting Periods**). Each financial year has twelve monthly
  periods, created when the first journal is posted into the year or ahead of time. The year starts in the
  organization's first fiscal month (default January). A period is **Open** (anyone who may post can), **Soft
  closed** (only finance staff with `period.close`, for final adjustments), **Closed** (nothing can be posted; reopen
  with a reason of 15+ characters and `period.reopen`) or **Locked** (final, never reopened).
- **Closing takes two people.** `period.close` (Finance) soft closes; `period.approve` (company administrator) closes
  and locks; whoever soft closed a period can't also close it. A period can only be closed once every earlier period
  *that has postings* is closed, and locked once those are locked; empty earlier months don't hold it up, so a company
  that starts mid-year isn't made to close months it never used. Every step is kept in the period's own trail and in
  the audit log.
- **Posted journals are immutable in the database itself.** Triggers reject any update or delete of a journal or its
  lines, even through SQL; the only change allowed is to stamp the period and source on an older journal that doesn't
  have them yet, once. A correction is a new, reversing journal. (`TRUNCATE`, used by the seed's reset, is not
  intercepted; a disposable database can set `wfp.allow_ledger_reset = 'on'` for a deliberate reset.)
- **Older databases:** `npm run ledger:backfill-periods` stamps each journal posted before periods existed with its
  period. It is idempotent and additive; back up first.
- **Not yet in this step** (the rest of Phase 1): the hierarchical chart of accounts, accounting dimensions on journal
  lines, general reversals with approval, manual and recurring journals, and the backfill of invoices and bills that
  were never posted.

### Chart of accounts: classes, groups, categories, sub-accounts

The chart is a hierarchy, not a flat list (Finance / Accounting → **Chart of Accounts**).

- **Class → group → category → account → sub-account.** The seven classes are Assets, Liabilities, Equity, Revenue, Cost
  of services, Operating expenses, and Finance and other income / expense. Each class holds the account types that make
  sense for it (class 7 holds both finance income and finance costs). Groups and categories can be added.
- **Install the standard chart** adds about 110 accounts across 28 groups and 43 categories (cash and bank, receivables,
  tax recoverable, inventory, property by kind with its accumulated depreciation, intangibles, payables, payroll and
  statutory liabilities, tax liabilities, client deposits, borrowings, leases, provisions, equity, guarding and other
  service revenue, direct labour and employer costs, operating expenses, finance income and costs). **It only adds and
  classifies.** An account that already exists is never renamed, retyped, recoded or reclassified; the 53 accounts the
  system posts to keep their codes and are simply placed in a category. An existing account that uses a standard code for
  a different kind of account is left exactly as it is. It is safe to run again.
- **Codes follow the group, not the other way round.** The codes the system already posts to predate this scheme (for
  example 5410 Depreciation Expense, which belongs under operating expenses), and changing a code on a posted account
  would rewrite history, so they stay.
- **Sub-accounts.** An account can hang under a parent of the same type. The parent becomes a **header**: it groups its
  sub-accounts and **cannot be posted to**. A parent that already has postings, or that a payroll head posts to, can't
  become a header. Taking the last sub-account out makes the parent postable again. A loop is refused.
- **What changes and what doesn't.** An account's **code and type never change**, because they are on posted journals.
  Its name, category, parent, description, usable-from and usable-until dates, financial-statement line and tax mapping
  can. The posting engine refuses an account used **before its start date or after its end date** (the first and last
  day are allowed), as well as header accounts.
- **Financial-statement line and tax mapping.** Each category reports under a statement line (trade receivables,
  property plant and equipment, payroll liabilities, revenue, and so on) which an account can override, and accounts that
  feed a tax carry a mapping (`VAT_OUTPUT`, `VAT_INPUT`, `WHT_RECEIVABLE`, `WHT_PAYABLE`, `PAYE`, `PENSION`, `NHF`,
  `ITF`, `NSITF`, `CIT`). **These are recorded and shown but not yet read by the financial statements or tax
  reports**, which still work from the account types; wiring them in belongs to the statements and tax phases.
- The page can be searched by code or name and filtered by class and status, and shows accounts not yet in a category
  separately. Only people with `gl.manage` see the edit controls; everyone with `gl.view` can read the chart.

### Accounting dimensions

An account says what kind of thing happened; **dimensions** say for whom and where. Every ledger line can carry up to
eleven: client, contract, beat / location, cost centre, department, employee, asset, region, branch, profit centre and
project (the company is the organization itself; revenue type and expense type are the account's category).

- **Where they come from.** The first seven are the records you already keep. **Region** (which can sit inside a
  larger region, so a zone is a region of regions), **branch**, **profit centre** and **project** (optionally for one
  client or contract) are new, under Finance / Accounting → **Accounting Dimensions**.
- **Fixed when posted, and checked.** The posting engine refuses a dimension that doesn't exist in the organization,
  an inactive region / branch / profit centre / project, and a contract that doesn't belong to the line's client. The
  dimension columns are covered by the same database triggers as the rest of a posted line, so they can't be changed
  afterwards, even through SQL. Retiring a region, branch, profit centre or project stops new postings using it and
  leaves what was posted alone.
- **Accounts can insist.** Under Chart of Accounts → Edit, an account can require dimensions ("posting needs a
  client"). The engine then refuses a posting to it that lacks one. Nothing requires any by default.
- **What carries dimensions today.** Client invoices split their revenue by **contract and beat** from the invoice
  lines, and carry the client on the receivable and the VAT; receipts and client deductions carry the client; vendor
  bills carry their cost centre; fixed assets carry the asset, its cost centre and its custodian through acquisition,
  depreciation (now one expense line and one accumulated-depreciation line per asset) and disposal; staff loans carry
  the employee. **Cancelling an invoice or bill mirrors the original journal line for line, dimensions included**, so a
  reversal cancels in every dimension. **Payroll does not carry dimensions yet** (client, contract, beat and employee
  cost from payroll is Phase 7 of the finance plan), so labour cost does not yet appear by client in the ledger.
- **Ledger by Dimension** (Finance / Accounting) shows income, expense and net result straight from the ledger split by
  any dimension and any date range. Only income and expense lines count. Lines that don't carry the dimension are one
  "not analysed" row, so the rows always add up to the whole ledger's result and the totals equal the trial balance's
  income and expense. A card shows what share of income is analysed.
- The journal page now shows each line's dimensions, its accounting period and its source document, and the integrity
  check reports a line pointing at another organization's record or a contract that isn't its client's.

### Route smoke test

Unit and integration tests prove the services; they can't prove a *page* renders. `npm run smoke` does:
it opens every page of the running app as each demo role and fails on anything unexpected.

- **What it checks.** For each of the eight roles it requests every page (about 140) — and a real record for
  every detail page, every tab of the employee page, every report in the Reports hub, and every link in the
  menus (about 1,400 requests). A page the role may open must answer **200** with no error page; a page it may
  *not* open must **redirect to /forbidden**; signed out, pages must go to **/login**. A menu item that leads a
  role to a forbidden page fails too.
- **Nothing to maintain.** The permission each page needs is read from the page's own `requirePage(...)`, so
  new pages are covered automatically. A new *detail* page needs a one-line sample-record lookup in
  `scripts/smoke.ts` — the run fails until it has one, so it can't be forgotten.
- **Run it locally** against a built, seeded app (reads only; it never posts or changes data):

  ```bash
  npm run build && npm start        # one terminal, database seeded
  npm run smoke                     # another; BASE_URL defaults to http://localhost:3000
  ```

  It signs in by minting the same session cookie the app issues (so it needs the app's `AUTH_SECRET` and
  `DATABASE_URL`). Use `--strict` to fail when a detail page has no sample record in the database (the demo
  data has none yet for fixed assets, client invoices, payables, purchase orders, exits, letters or
  settlements, so those pages are noted as skipped rather than opened).
- **Beside a running dev server.** `next dev` and `next build` share the `.next` folder and corrupt each
  other. Set `NEXT_DIST_DIR=.next-smoke` for both `next build` and `next start` to keep the test build apart.
- **In CI** it runs after the build, against a freshly seeded database. A separate fast unit test
  (`tests/unit/nav-routes.test.ts`) also checks, with no server, that every menu link points at a real page and
  no role is shown a link its page refuses.

### Navigation

- The sidebar is grouped into collapsible menus — **Dashboard, Workforce / Personnel, HR Lifecycle,
  Payroll, Operations (incl. Stock & Kit), Leave Management, Finance / Accounting, Analytics, Settings / Support,
  My Workspace** — matching how the
  business is organized. Click a menu to expand it; the menu containing the current page auto-expands.
  Long menus (Payroll, Finance / Accounting) carry small sub-headings (e.g. "Payments", "Payroll reports")
  above the items they group. The Reports hub (`/reports`) mirrors the same grouping.

### Security & platform hardening

- **Login protection.** Rate limiting locks an account for 15 minutes after 5 failed attempts;
  lockout is indistinguishable from a wrong password to the client, so it can't be used to
  enumerate valid accounts.
- **Two-factor authentication.** Optional TOTP (Google Authenticator, Authy, etc.), self-service
  enrollment with a QR code, 10 single-use hashed backup codes, under **My Workspace → My
  Security**.
- **Requiring two-factor by role.** **Settings → Users → Two-factor sign-in** (`users.manage`): tick the roles
  that must use it and the first day it is compulsory. Before that day those users see an amber banner on
  every page counting down the days, with a link to My security. From it, anyone in those roles who hasn't set it up is sent to My security from every page and
  refused on every action (so downloads and API routes can't be used to get round it), and can't switch it off
  again. You can't set a requirement that would lock you out of your own account on the day it starts. If
  someone loses their phone *and* their backup codes, an administrator can **Reset 2FA** from the Users list —
  a written reason is required, it's audited, their sessions end, and it never works on your own account. Off
  until someone sets it.
- **Password reset.** `/forgot-password` → emailed single-use link (30-minute expiry) →
  `/reset-password`. Resets and self-service password changes both invalidate every other signed-in
  session. Email sends via Resend when `RESEND_API_KEY` is set; otherwise the link is logged to the
  server console so local development needs no email account at all.
- **Session revocation.** Every session JWT carries a `sessionVersion`; bumping it (logout
  everywhere, password change, deactivating a user) invalidates every outstanding token instantly,
  without a server-side session store.
- **Error tracking & logging.** Unexpected errors are logged as structured JSON and reported to
  Sentry (inert until `SENTRY_DSN`/`NEXT_PUBLIC_SENTRY_DSN` are set) with cookies, auth headers, request bodies
  and query strings dropped, the user reduced to an id, and anything that looks like an email address, phone
  number, account/ID number or token in messages, breadcrumbs and extra data replaced by a placeholder, before
  the event ever leaves the process (`src/lib/pii-scrub.ts`); expected business/permission errors still show
  their real message to the user. A global error boundary replaces Next's default crash screen.
- **CI.** `.github/workflows/ci.yml` runs lint, typecheck, the full test suite, and a production
  build against a real Postgres service on every push/PR.
- **Data protection.** `docs/data-protection-policy.md` — an honest first pass, including the gaps
  that still need a decision (a retention schedule for employee records, erasure requests, and who is on
  call for a breach).

---

## Project layout

```
prisma/schema.prisma            data model (47 tables)
prisma/migrations/              SQL migrations
prisma/seed.ts                  demo data (110 employees, 5 clients, 8 contracts, 20 beats, 3 periods)
prisma/hr-demo.ts               HR lifecycle demo data — run by the seed, or alone against a live database
                                (`npx tsx prisma/hr-demo.ts`; idempotent, never touches existing records)
src/lib/eos.ts                  pure end-of-service rules (leave, gratuity, severance, notice) — unit-tested
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

Tests that change org-wide settings (HR policy, checklist templates) or need exact figures use
`isolatedOrg()` from `tests/helpers.ts` — a throwaway organization with its own users per role — so they
can't disturb the other files, which share the seeded org and run in parallel.

First run of Playwright on a new machine: `npx playwright install chromium`.

---

## Notes & next steps

- Payroll month proration uses calendar days (configurable to fixed 30). Monthly PAYE annualises the
  month's regular income; a cumulative (year-to-date) PAYE method is a sensible next enhancement.
- NHF relief exists in the rule engine but is disabled in the seed.
- **Stock — not built yet:** posting stock to the GL (inventory asset on receipt, expense on issue — today
  uniform cost reaches the books through the payroll "Uniform & Kits" employer add-on and vendor bills);
  receiving stock straight from a purchase order / vendor bill; per-location stores and transfers between
  them; barcode / QR scanning; and an employee sign-off (acknowledgement) when kit is issued.
- **HR lifecycle — not built yet, in rough order of value:** **letter generation** (offer,
  contract, termination, experience and clearance letters from templates, with e-signature);
  **SMS / push notifications** and per-person alert preferences (the daily email digest exists, but
  it goes to HR admins only and every item is included); a **monthly gratuity accrual** to the GL (today it posts only when paid through
  payroll); **per-country end-of-service presets** (gratuity / severance / tax defaults as
  selectable packs); **performance reviews** feeding probation decisions; a **retention schedule**
  for rejected candidates and closed cases (privacy law); **approval chains by amount** with delegation
  for approvers on leave; and a public careers page / candidate portal.
- Future integrations (biometric, GPS, QR, bank APIs, NIBSS/PFA file formats) are out of scope for the MVP.
- Prisma uses the `pg` driver adapter with the query-compiler preview (no native query-engine binary).
  If you prefer the classic engine, remove `previewFeatures`/`engineType` from `schema.prisma` and the
  adapter from `src/lib/db.ts`.
