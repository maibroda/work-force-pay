# Workforce ERP — Finance & Accounting architecture, gap analysis and build plan

**Status: proposal for approval. Nothing in this document has been built yet.**
Written 2026-10-09 after reading the existing schema (102 models), the 50 service files, the finance pages and the
README. Where this says "have", it was checked in the code, not assumed.

The brief is several products' worth of work (finance, a tax engine, an approval engine, a universal multi-industry
layer, and a CRM). It says to inspect first, extend rather than rebuild, and build in controlled phases. This
document does that: what exists, what is missing, the target design, the order, and the decisions that are yours.

---

## 1. What already exists (do not rebuild)

| Area | What is there today | Where |
| --- | --- | --- |
| Tenancy | Every table carries `organizationId`; every query is scoped; `isolatedOrg()` proves isolation in tests | all services |
| General ledger | `GlAccount` (5 types), `JournalEntry` + `JournalLine`, balanced by construction, numbered `JV`, `source` tag, one-journal-per-run idempotency | `accounting.ts`, `gl-posting.ts` |
| Auto-posting | Payroll lock, client invoice / receipt / deduction, vendor invoice / payment / deduction, bank opening, fixed-asset acquisition / disposal / monthly depreciation, loan disbursement / repayment / write-off | `gl-posting.ts` |
| Statements | Trial balance, income statement, balance sheet, all summed from `JournalLine`; balance sheet balances to the kobo | `financial-statements.ts` |
| Client billing | One invoice per client per locked payroll run; lines per category, with contract and beat; **90/10 direct / indirect split already stored**; VAT % and WHT % per run; receipts; deductions that need a reason and a document | `billing.ts` |
| Payables | Vendors, purchase orders with approval, purchase invoices, payments, deductions | `payables.ts`, `purchase-orders.ts` |
| Fixed assets | Register, straight-line depreciation computed on the fly, disposal, monthly depreciation journal that can't run twice | `fixed-assets.ts` |
| Bank | Operating account, CSV statement import, one-to-one auto-match, reconciliation statement | `bank-reconciliation.ts` |
| Costing | Cost centres, monthly budgets per centre, contract and client profitability, variance analytics | `cost-centers.ts`, `analytics.ts` |
| Controls | Audit log; 9 roles and about 65 permissions; 2FA by role; maker/checker on most HR and payroll approvals; numbering rules | `audit.ts`, `permissions.ts`, `numbering.ts` |
| Tests | 489 tests including end-to-end payroll to ledger; CI runs lint, typecheck, tests, build and a route smoke test | `tests/` |

The chart already uses the requested ranges for payroll: 1200 receivables, 2100–2170 liabilities, 5100–5360 direct
labour. Re-coding is not needed to adopt the 1000–7000 class scheme.

## 2. Gap analysis against the brief

Status: **Have** / **Partial** (exists, differs from the brief) / **Missing**.

### Accounting foundation

| Requirement | Status | Finding |
| --- | --- | --- |
| Hierarchical chart (class → group → category → account) | Partial | Flat list with five types. No hierarchy, no effective dating, no statement or tax mapping |
| Dimensions on postings (client, contract, branch, region, cost centre, profit centre, project, employee, asset) | **Missing** | `JournalLine` has an account and an amount and nothing else. Profitability today is computed from payroll allocations, **not from the ledger**, so a report cannot yet drill to a journal line |
| Fiscal years and accounting periods (open / soft-closed / closed / locked) | **Missing** | Only `PayrollPeriod` closes. Any journal can be dated any day. Nothing stops posting into a closed month |
| Posted entries immutable | Partial | True by convention (no edit screen) but not enforced by the database |
| Reversal | **Missing** | Invoices can be cancelled only if nothing has been paid; journals cannot be reversed |
| Manual, recurring, accrual, reversing, reclassification journals with approval | Partial | A manual posting path exists for payroll only; no general journal entry, no approval, no recurrence |
| Period-end snapshot, close checklist, year-end close | **Missing** | |
| Multi-currency | Partial | Display-only (stated honestly in the README); no rates, no FX gain / loss |
| Multi-company inside one tenant, consolidation | **Missing** | One organization = one company |

### Receivables, billing and tax

| Requirement | Status | Finding |
| --- | --- | --- |
| Invoice lifecycle: draft → review → approve → post → sent | **Missing** | An invoice is created already `ISSUED` and posted in the same step |
| Proforma invoices | **Missing** | |
| Credit notes and debit notes (issued and received) | **Missing** | Corrections go to "the next run" |
| Receipts allocated across many invoices, unallocated and advance receipts, refunds | **Missing** | A receipt belongs to exactly one invoice |
| Client statement with running balance, ageing buckets, PDF / Excel / CSV | Partial | A billing summary exists; no statement document, no ageing |
| Monthly AR report as an official period-end record | **Missing** | Today's figures are live |
| VAT as a configurable, effective-dated engine with taxable base per charge | Partial | VAT is **already** computed on the indirect / management charge only (`billing.ts`: `vatAmount = totalIndirectCharge × vatPct`), which is the brief's 90/10 treatment. But the rate is typed in per run, not read from an effective-dated tax code, and the taxable base is fixed in code rather than set per service or contract (see D1) |
| WHT engine, certificates, WHT receivable on the statement | Partial | WHT % is informational on the invoice; a withheld amount can be recorded as a deduction; there are no certificates and no WHT report |
| Service / billing rule master (90/10 per service, contract overrides with approval) | **Missing** | 90/10 is stored on the invoice, defaulting to 90/10; it is not configurable per service or contract |
| Output / input VAT ledger and VAT report | **Missing** | Purchase VAT is folded into expense (documented simplification) |

### Payables, cash, assets

| Requirement | Status | Finding |
| --- | --- | --- |
| Goods / service receipts and three-way match | **Missing** | PO converts straight to an invoice |
| Supplier credit and debit notes, supplier statements, AP ageing | **Missing** | |
| Purchase order approval with segregation of duties | Partial | The README states the PO approver has the same permission as the requester, so one person can request and approve |
| Several bank accounts mapped to the ledger; AR / AP cash posting to the actual bank account | Partial | The model supports several accounts, but reconciliation is single-account and cash posts to one default account |
| Cash flow statement | **Missing** | |
| Asset categories, reducing-balance and units-of-production methods, transfers, impairment | Partial | Straight-line only, no categories, no movements. Known gap: an asset bought through Payables and registered separately posts its cost twice |

### Controls, analytics, platform

| Requirement | Status | Finding |
| --- | --- | --- |
| Generic approval engine (amount thresholds, levels, delegation, escalation) | **Missing** | Approvals are separate code per module |
| Document attachments linked to transactions | Partial | A free-text "supporting document reference" on deductions; no files |
| Reconciliation centre (AR, AP, bank, payroll, VAT, WHT, subledger to GL) | **Missing** | |
| Month-on-month and year-on-year comparison engine, margin alerts, insight engine | Partial | Variance analytics exist for cost centres (`analytics.ts`, `reports.ts`); no general engine |
| Cost allocation rules (revenue %, headcount, payroll %) | **Missing** | A fixed "back-office %" setting only |
| Budgets beyond cost centres (client, contract, region), budget vs actual | Partial | |
| Client portal | **Missing** | |
| Industry templates, optional modules, configurable terminology, onboarding wizard | **Missing** | "Guard", "Beat" and "Post" are hard-coded through the schema, pages and tests |
| CRM (leads, accounts, contacts, opportunities, quotes, forecasting, cases) | **Missing** | The existing `Client` is a billing master; there is no sales side at all |

## 3. Target architecture

### 3.1 One posting pipeline

Every financial effect goes through a single server-side function and nothing writes a journal any other way:

```
source document ──► validate ──► (approval) ──► postJournal() ──► JournalEntry + JournalLine (+ dimensions)
                                                     │
                                                     └─► period check · balance check · account/dimension checks · audit entry
```

- `postJournal(tx, …)` replaces the ad-hoc inserts in `gl-posting.ts`. It refuses: unbalanced entries, inactive or
  unknown accounts, a missing required dimension, a document number already used, and **any date in a closed or
  locked period**.
- **Immutability is enforced in the database**, not only in code: a trigger rejects `UPDATE` and `DELETE` on posted
  `JournalEntry` / `JournalLine` rows. Corrections are a *reversal*, a new entry that mirrors the original and points
  at it (`reversalOfId`), created through an approval.
- Documents share one lifecycle: `DRAFT → SUBMITTED → APPROVED → POSTED → REVERSED`. Only `DRAFT` (and `SUBMITTED` by
  an authorised user) is editable. `POSTED` is never edited or deleted.

### 3.2 Data model additions (all additive; no existing table is dropped or re-purposed)

- **Chart:** `AccountClass`, `AccountGroup`, `AccountCategory`; `GlAccount` gains `categoryId`, `parentId`,
  `effectiveFrom/To`, `statementLine`, `taxMapping`. Existing accounts are backfilled into the standard classes by
  code range, so nothing existing is re-coded.
- **Dimensions:** `JournalLine` gains nullable foreign keys to the dimensions that already exist as master data (client,
  contract, beat, cost centre, department, employee, fixed asset) plus new masters `Branch`, `Region`, `ProfitCentre`,
  `Project`. Which dimensions are *required* per account is configuration.
- **Periods:** `FiscalYear`, `AccountingPeriod` (status OPEN / SOFT_CLOSED / CLOSED / LOCKED, closer, approver, reopen
  reason), `PeriodSnapshot` (trial balance, AR and AP by client and invoice, bank and tax balances, ageing), and
  `CloseChecklistItem`.
- **Tax engine:** `TaxCode`, `TaxRate` (effective-dated), `TaxRule` (which service, charge type, customer or exemption it
  applies to), `TaxTransaction` (one row per taxed posted line, which is what the VAT and WHT reports read), and
  `TaxCertificate`.
- **Billing rules:** `ServiceType`, `BillingRule` (direct %, indirect %, taxable base, revenue and tax accounts),
  `ContractBillingOverride` (effective-dated, with reason and approver). The 90/10 split lives here, defaulting to the
  Security & Guarding service type, never in invoice code.
- **Receivables:** `Receipt` (customer-level), `ReceiptAllocation` (receipt ↔ invoice or debit note), `CreditNote`,
  `DebitNote`, `ProformaInvoice`; `ClientInvoice` gains `documentStatus`, `reversalOfId`, `replacesId`, `proformaId`.
  Balances come from allocations, so one receipt can settle many invoices and an invoice can have many receipts.
- **Approvals:** `ApprovalPolicy` (document type, amount band, level, approver role or user), `ApprovalRequest`,
  `ApprovalStep`. Segregation of duties is a rule in the engine, so no module can forget it. Existing maker/checker
  code keeps working until each module is moved over, one at a time.
- **Attachments:** `DocumentAttachment` linked to any document.
- **Currency:** `Currency`, `ExchangeRate`; transaction currency, rate and base amount on documents and lines.

### 3.3 Reporting reads the ledger

Statements, ageing, profitability and the comparison engine all read `JournalLine` and its dimensions, so every
figure drills: *report → account → client → contract → invoice → journal → operational source*. Closed periods read
`PeriodSnapshot`, so an official September report does not change in November. Live balance and period-end balance
are always labelled separately.

## 4. Build order

Eight controlled phases, each its own set of PRs with tests, and each leaving the app working. This is the brief's
nine phases reordered where the existing code allows.

| Phase | Scope | Exit criteria (tests that must pass) |
| --- | --- | --- |
| **0. Safety net** | Backup and restore scripts, a ledger integrity check (every journal balances, subledgers equal control accounts) run in CI, characterisation tests of today's invoice, receipt and statement figures | Integrity check green on the seeded data; a restore is rehearsed |
| **1. Foundation** | Chart hierarchy and standard classes, dimensions on journal lines, fiscal years and periods with open / close / lock, `postJournal()`, DB immutability trigger, reversals with approval, manual and recurring journals | Cannot post into a locked period; posted entries cannot be updated or deleted even by SQL; a reversal mirrors exactly; every journal balances |
| **2. Tax and billing rules** | Tax engine (VAT, WHT, effective-dated), service / billing rule master, contract overrides, invoice calculation reading them | Results identical to today for the default rule (VAT on the indirect charge only); rate read from the engine by date; an override needs approval; old posted invoices unchanged |
| **3. Receivables** | Invoice draft → approve → post, proforma, credit and debit notes, receipts with allocation, WHT split, statements with ageing, PDF / Excel / CSV | Draft doesn't touch the ledger; posted invoice is immutable; ₦10m receipt across three invoices; WHT splits into cash and receivable; statement balance equals the control account |
| **4. Period close** | AR monthly report from snapshot, reconciliation centre, close checklist, year-end close | A closed month's report is reproducible after later activity; close is blocked while AR does not equal GL |
| **5. Payables and procurement** | Receipts of goods, three-way match, supplier credit notes, input VAT, supplier statements, AP ageing | Cannot pay a bill that fails the match without approval; no duplicate liability |
| **6. Cash, bank and assets** | Several bank accounts, AR / AP cash to the right account, cash flow statement, asset categories, other depreciation methods, transfers, impairment, link to purchase invoices | Bank, book and GL agree; an asset bought through Payables posts once |
| **7. Analytics and approvals** | Generic approval engine adopted module by module, comparison engine, allocation rules, budgets by client / contract, profitability from the ledger, alerts | Profitability equals the ledger; a request can't be approved by its maker |
| **8. Platform and CRM** | Industry templates, module switches, terminology layer, onboarding; then CRM; then client portal | Scenario A (security) and Scenario B (consulting) both run on the same finance engine |

Phase 8 is deliberately last. The terminology and module-switch layer touches almost every page, and CRM is roughly
twenty new tables, so both are best built on a finance core that has stopped moving. They are as large as phases
1–7 together.

## 5. Decisions that are yours

**D1. VAT base.** *Correction to the first draft of this document, which said otherwise:* the code already
calculates VAT on the indirect / management charge only, matching the brief, so there is no change in tax
treatment to approve. (The README sentence "added on top of the subtotal" was misleading and is corrected in the
same change.) What is still missing is configurability: the rate is typed per run and the base is fixed in code.
The plan is to move both into effective-dated tax and billing rules, with today's behaviour as the default for the
Security & Guarding service type, so existing results do not change. Whether that treatment is right for each
client agreement remains a question for your tax adviser (see D4).

**D2. Segregation of duties will change today's behaviour.** The README says a purchase-order approver can be the
requester. Once the engine enforces segregation, a small team with one finance user will find it cannot approve its
own orders. Do you want a documented break-glass override (second person, reason, audited), or strict separation?

**D3. Sequencing.** I recommend phases 0–4 first (the ledger, tax, receivables and a reproducible month-end), then
payables and bank, then the universal / CRM layer. Say if CRM or the multi-industry layer should come earlier.

**D5. Historic documents without journals.** For any database whose invoices or bills pre-date the ledger
postings (the development database is one), Phase 1 will offer a one-off backfill. Posting each at its original date
puts entries into past months; carrying them in as an opening balance as at a chosen date leaves history alone but
loses the monthly detail. Which suits depends on whether any of those months has already been reported to a tax
authority or auditor. This is for you and your accountant; I will implement whichever you choose.

**D4. Statutory sign-off.** I will build VAT, WHT and PAYE reporting to the rules as configured, but I cannot certify
compliance. Someone qualified should review the tax mappings and reports before go-live.

## 5a. Phase 0 — what it found

Phase 0 (the safety net) is built; see the README section "Ledger integrity, backups and restore rehearsal".
Reading the ledger as an auditor would turned up three things the earlier audit had not:

1. **Cancelling an invoice or vendor bill did not reverse the ledger.** Only the status changed, so the receivable
   and revenue (or payable and expense) stayed in the books and the subledger drifted from the control account.
   Fixed in Phase 0: cancelling now posts a reversing journal in the same transaction. This is the first, minimal
   form of the reversal that Phase 1 generalises.
2. **A database that predates the ledger postings has documents with no journal.** The development database holds
   10 client invoices, 3 receipts and a vendor bill but only 5 journals, so receivables read 19,397,903.09 in the
   subledger and 0.00 in the ledger. This is old demo data, not a code fault, but any real database that was
   running before AR / AP posting was added would look the same. The check reports it; it has deliberately **not**
   been repaired. Phase 1 needs a backfill decision: post the historic documents at their original dates, or carry
   them in as opening balances (see D5).
3. **Journals do not record which document produced them.** They carry a `source` label and a text description,
   not a document reference, so "invoice with no journal" can be seen only as a total difference, not named.
   Phase 1 adds `sourceType` and `sourceId` to the journal, which also makes drill-down to the originating
   document possible.

Also corrected here: the first draft said VAT was charged on the whole subtotal. It is already charged on the
indirect charge only (see D1).

## 5b. Phase 1, first step — built

The posting engine, accounting periods and database-enforced immutability are built (README: "Accounting periods and
the posting engine"):

- every journal is written by one function that refuses unbalanced, one-line, negative, two-sided or inactive-account
  journals and any date in a closed period, and records the period and the source document;
- fiscal years and monthly periods (open / soft closed / closed / locked), two-person closing, reopening with a reason,
  an append-only trail per period, and a lock that is final;
- triggers that make posted journals and lines impossible to edit or delete, even through SQL;
- the integrity check now also reports journals without a period and documents no journal points at.

**Decisions taken.** D2 (segregation of duties): strict by default with a break-glass override; the override arrives with
the approval engine (Phase 7), so for now closing is strictly two-person. D3 (sequencing): finance first, the
multi-industry layer and CRM as phase 8.

**Chart of accounts — built.** Class → group → category → account → sub-account, an installable standard chart that only
adds and classifies, header accounts that can't be posted to, effective dates enforced by the posting engine, and
statement-line and tax-mapping fields (recorded, not yet read by the statements; see the README).

**Dimensions on journal lines — built.** Eleven dimensions (client, contract, beat, cost centre, department, employee,
asset, region, branch, profit centre, project), four new masters, required-dimension rules per account, checks in the
engine and the integrity check, the same database immutability, invoices split by contract and beat, mirrored
reversals, and a Ledger by Dimension report that reconciles to the trial balance. Payroll does not carry dimensions
yet (Phase 7).

**Manual journals and reversals — built.** Manual journals as approved documents (draft, submit, approve by someone else,
post), frozen by the database once submitted; kinds manual, adjustment, reclassification and accrual, with accruals
reversing themselves on their date; reversal of any posted manual journal by request and approval, posting an exact
mirror; control accounts (receivables, payables) closed to manual postings; an approval on/off setting. System-generated
journals are corrected through their own documents, not reversed on their own.

**Recurring journals — built.** A template (lines, frequency, month-end option, end date, accrual reversal interval) that
generates an ordinary manual-journal draft each period through a scheduled route or a button. The draft keeps the full
submit / approve / post path; the template never posts and carries no approval of its own. The preparer is whoever last changed
the template, one journal per template per date is enforced by the database, schedules are frozen once used, and automatic
submission never applies when approval is off.

**Still to do in Phase 1:** the backfill of historic unposted documents (D5, awaiting the decision).

## 5c. Phase 2, first step — tax engine (built)

Tax codes and effective-dated rates (`TaxCode`, `TaxRate`), with maker/checker on every rate and a database trigger that makes
an approved rate immutable; `TaxTransaction` written with each invoice and marked reversed on cancellation, read by the new Tax
Reports and verified by the integrity check; the invoice calculation reads the rate in force on its date and records what it used.
A typed rate for a run still works and is recorded as such. With no codes configured the result is identical to before; with
the default code the VAT base is unchanged (indirect charge only). Invoices issued before the engine were backfilled with tax
records from their stored figures.

## 5d. Phase 2, second step — billing rules (built)

`ServiceType` and `BillingRule` (one table, scoped to a service type or to one contract, in place of the separate
`BillingRule` / `ContractBillingOverride` of section 3.2). A rule carries the direct / indirect split, the VAT and withholding
bases (indirect, direct, whole amount, nothing), optional tax codes, and dates; it is proposed by one person and approved by another,
a database trigger makes an approved rule immutable, and a new rule can't start on or before an existing rule or an invoice already
issued under it. Resolution per contract on the invoice date: its approved override, else its service type's rule, else the built-in
default (90/10, VAT on indirect, withholding on the whole amount). Invoicing works out tax once per code and rate across contracts,
records the rule used on the invoice and each line, and writes a tax record per group. Existing organizations were given a
Security & Guarding type holding the original treatment as an approved rule; with it the same inputs give the same invoice to the
kobo (tested). Typed splits and rates for a run still work and are recorded as typed.

Certificates (withholding) and input VAT follow in Phases 3 and 5.

## 5e. Phase 3, first step — receipts, advances and statements (built)

`ClientReceipt` becomes the customer-level receipt (its invoice is now optional; the single-invoice receipts are untouched), with
`ReceiptAllocation` (cash and tax withheld applied to an invoice; immutable, reversed with a reason), `ClientRefund` (maker/checker) and
account 2192 for advances. Recording a receipt, its allocations and the journal are one transaction; the invoice's settled amounts and status
move with a guarded update so concurrent receipts can't overfill an invoice. Statements and ageing are built from the invoices and what settled
them, as at any date, and tie to the client's balance in the receivables account; the integrity check reconciles advances to 2192 and flags a
client whose ledger balance differs from their invoices. (The brief called these `Receipt` / `ReceiptAllocation`; extending `ClientReceipt`
kept bank matching and every existing figure intact.)

## 5f. Phase 3, second step — credit and debit notes (built)

`ClientNote` (credit or debit, maker/checker, immutable once decided) raised against an invoice. Approving it posts to the ledger, writes a
signed VAT record and moves the invoice's `totalCredits` / `totalDebits` in a guarded update; the invoice is never edited. What is owed is
computed from the total, the notes, payments and deductions in one place (`lib/notes.ts`) and used by billing, receipts, statements and the
integrity check (which verifies the stored credits and debits against the approved notes). Deliberately simpler than the brief's
"allocatable like invoices": a debit note adjusts a specific invoice and shares its due date, so receipts and ageing work unchanged.

## 5g. Phase 3, third step — invoice lifecycle and proforma (built)

Invoice generation is split into a pure planning step (each contract under its billing rule, the split, the tax) and a saving step. Where the
organization requires approval (`invoiceApprovalRequired`, off by default so existing behaviour is unchanged) the plan is saved as a DRAFT under a
provisional number and nothing else; a second person's approval numbers it, writes the tax records and posts it. The same planning step gives the
proforma, which saves nothing. A database trigger makes a posted invoice and its lines immutable (only settlement fields, status and sent-details move)
and forbids deleting one. Drafts are excluded from receivables, statements, the subledger and the integrity checks. (The brief's separate
`ProformaInvoice` table and an explicit APPROVED-then-POSTED state were not needed: a proforma is computed on demand, and approval posts, as for
notes and refunds.)

## 5h. Phase 3, last step — withholding certificates (built)

`TaxCertificate` is a register of certificates received from clients (append-only; voided once with a reason; a trigger refuses edits and deletes).
Rather than a link table, certificates are matched to what was withheld by client and normalised number, because receipts and deductions already carry
the number the client quoted; the reconciliation reports matched, missing, short, over and unrecorded certificates and the amount still to chase.

**Phase 3 is complete**, with these deliberate gaps against the brief: a debit note adjusts an existing invoice rather than standing alone; statements are
CSV plus the browser's print/save-as-PDF (there is no PDF or Excel library in the project, and CSV opens in Excel); certificates *issued* by us belong
with payables. Next is Phase 4 (period close, AR snapshots and the reconciliation checklist).

## 6. Safety rules for every migration

All migrations are additive. Before each one: dump the database, run it on a copy, run the ledger integrity check
before and after, and rehearse the restore. Backfills are idempotent. No migration deletes or rewrites a posted
journal, invoice or payment; where an old status maps to a new one (for example `ISSUED` to `POSTED`), the mapping is
listed in the migration and tested.
