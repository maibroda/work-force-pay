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

**Still to do in Phase 1:** recurring journals (a template that generates a draft each period); the backfill of historic
unposted documents (D5).

## 6. Safety rules for every migration

All migrations are additive. Before each one: dump the database, run it on a copy, run the ledger integrity check
before and after, and rehearse the restore. Backfills are idempotent. No migration deletes or rewrites a posted
journal, invoice or payment; where an old status maps to a new one (for example `ISSUED` to `POSTED`), the mapping is
listed in the migration and tested.
