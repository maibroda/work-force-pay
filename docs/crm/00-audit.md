# CRM module, Phase 0: read-only audit and mapping

**Status: report only. Nothing was built, no migration was run, `CLAUDE.md` was NOT changed.** Written 2026-10-29 from the repository as it stands on `main` plus the open PR stack (#83 to #92; see section 1). Everything below is checked against the code, not recalled. It waits for your decisions in section 7 before Phase 1.

## 0. The five things you most need to know

1. **WorkforcePay already has a CRM, but a different one.** It is the **bureau's own sales pipeline for selling payroll services** (`Lead`, `LeadStageChange`, `OutreachActivity`, `ReferralPartner`, `ReferralPayout`, `Proposal` with `PricingPackage`/`PricingAddOn`, `HealthCheck`; files `src/lib/crm.ts`, `src/server/services/crm.ts`, `proposals.ts`, `pricing.ts`, `proposal-pdf.ts`; permissions `crm.view`/`crm.manage`; the `BUSINESS_DEV` role). It is limited to the **bureau's own organization** (`crmAvailable` checks `Organization.isBureau`). The pack describes a **different CRM**: one a deployed-workforce company (guards, cleaners, staffing) uses to sell **guarding posts** to its own clients. Same word, different product, same names (`Lead`, `Opportunity`, quotes, cases). They must not be merged by accident.
2. **The pack's `Account` already exists as `Client`** (with `Contract`, `ContractRate`, `Beat` (site), `Deployment`, `ClientInvoice`), so the pack's biggest idea (won deal becomes operations) has real targets to land on. **But there is no "draft" for a client, a contract rate or a site**; only `Contract` has a `DRAFT` status (section 5.F).
3. **The pack's rules disagree with `CLAUDE.md` and the codebase on four points** (money as `bigint` kobo, row-level security, `deleted_at`, snake_case ids). I recommend following the codebase and `CLAUDE.md`, and I have written a **reconciled version of the pack's rules** (section 8) for you to approve **before** anything is appended to `CLAUDE.md`. I did not append the pack's Part C as pasted, because two of its lines would contradict rules you already set.
4. **There is no cost-per-post function.** Nothing returns "monthly employment cost of one guard on a 12-hour night post". The ingredients exist (pay structures, the pure payroll engine, employer add-on costs, the 70:30 share), but "post type" and "shift pattern" are not concepts in the app (section 4). The quote builder needs a new read-only estimator and a decision on what a "post type" is.
5. **Personal data and the append-only audit log pull against each other.** NDPA erasure needs personal data replaced; the audit log is append-only and tamper-evident. The redaction mechanism for that is built (`redactAuditRows` with a keyed proof) but lives in **#84, which is not merged**. Phase 9 depends on it.

## 1. Stack, as found

| Area | What is there |
| --- | --- |
| Language, framework | TypeScript; Next.js 15 (App Router, server actions, route handlers); React 19; Tailwind 3 |
| Database, ORM | PostgreSQL; Prisma 6 (`prisma/schema.prisma`, 168 tables, 125 enums); `pg` adapter |
| Migrations | Prisma Migrate, one folder per change. **Since 2026-10-29 every migration has a hand-written `down.sql`** that is round-tripped in a rolled-back transaction (`CLAUDE.md` rule 7). Latest on the stack: `20261105160000_split_payroll_banks` |
| Auth | Own implementation: bcrypt passwords, `jose` signed sessions, TOTP two-factor (`otpauth`), login lock-out; `Ctx` carries `userId`, `orgId`, `role`, `homeOrgId` |
| Tenancy | **Every table has `organizationId`; every service query is scoped with it** (`org(ctx)` helper in `src/server/services/_base.ts`). **There is no row-level security in the database** (searched migrations, schema and docs). Isolation is proved by per-service tests ("another organization learns nothing") |
| Roles, permissions | Fixed `Role` union of 12 roles; `PERMISSIONS` list; `can(role, permission)`; `assertCan` in every service. Roles are code, not data |
| UI | Own components in `src/components` (`SmartForm`, `Section`, `PageHeader`, `ui/table`, `ui/badge`, `ui/button`), no external UI kit; `recharts` for charts; `lucide-react` icons |
| Tests | Vitest 5: 143 files, about 1,600 tests; one Postgres test database re-seeded each run (suites must run alone); `tests/golden` for payroll; `isolatedOrg()` helper makes a throw-away tenant. Playwright is installed, not used for CRM |
| Background jobs | **No queue.** Scheduled work is Next route handlers under `src/app/api/cron/*` called by an external scheduler with `Authorization: Bearer $CRON_SECRET` (`src/lib/cron-auth.ts`), each wrapped in `recordJob` (`job-runs.ts`). Eight exist (audit seal, verify, heads, data retention, HR digest, journal reversals, payroll reminders, recurring journals). **No delayed-job table, no retry, no worker** |
| Messaging | **Email only**, through Resend (`src/lib/email.ts`; with no key it only logs). **No SMS, no WhatsApp API.** Click-to-call and `wa.me` links need nothing wired |
| Files | **No object storage** (the schema says so in two places). PDFs are generated with `pdf-lib` on demand (`proposal-pdf.ts`, `payslip-pdf.ts`); uploads (survey photos, import files) would need a decision |
| Audit | `AuditLog` (append-only by trigger), `logAudit(ctx, entry, tx)`, tamper-evident seals (`AuditSeal`; **#84, unmerged**) |
| Numbering | `nextNumber(tx, orgId, KIND)` for gap-free document numbers |
| Feature flags | **None.** `CLAUDE.md` rule 8 asks for them; `docs/rules-conformity.md` records this as unmet |
| Effective-dated settings | `TaxRule`, `PayrollRule`, pension rules, with version history and an "adviser verified" fingerprint gate. Employer add-on cost percentages are payroll-rule data |
| Open work | The stack #83 to #92 is unmerged, and none of it touches CRM files. A CRM branch should start from `main` |

## 2. Existing entities the CRM must reuse

| Concept | Table(s) | Key columns and relations |
| --- | --- | --- |
| Client (the pack's Account) | `Client` | `organizationId, code, name, contactPerson, address, phone, email, status (ACTIVE, INACTIVE, SUSPENDED, CLOSED), startDate, endDate`; has `contracts, beats, invoices, receipts, notes, employees` |
| Contract | `Contract` | `clientId, contractNumber, name, startDate, endDate, contractValue Decimal(16,2), billingMethod (PER_HEAD_MONTHLY, LUMP_SUM_MONTHLY, PER_SHIFT), status (DRAFT, ACTIVE, EXPIRED, TERMINATED), operativeSharePct (the 70:30), businessLine (GUARDING, OUTSOURCING), defaultStructureId, serviceTypeId` |
| Rate card | `ContractRate` | `contractId, categoryId (EmployeeCategory), salaryStructureId, agreedRate Decimal(14,2) per head per month, operativeSharePct?, effectiveFrom, effectiveTo`. **Effective-dated, no status column** |
| Site / location | `Beat` | `clientId, contractId, code, name, state, lga, address, siteContact, approvedStrength, status (UNMAPPED, MAPPED, UNDERSTAFFED, OVERSTAFFED, INACTIVE), supervisorId, bidReference` |
| Post / position | **None as such.** `Beat.approvedStrength` is a headcount; `EmployeeCategory` (Security Guard, Dog Handler, Site Supervisor...) is the nearest "post type"; `Deployment` places an employee on a beat/contract |
| Invoice, billing | `ClientInvoice`, `ClientInvoiceLine`, `ClientReceipt`, `ClientNote` (credit/debit, maker-checker), `ClientRefund`, `BillingRule`; services `billing.ts`, `receipts.ts`, `client-notes.ts` |
| Users, roles | `User` (role, organization); `StaffClientAccess` (which bureau staff may work in which client); `ClientEngagement` (bureau client lifecycle) |
| Approval (maker-checker) | **No generic engine.** Each module enforces it itself: invoices (`approveInvoice` refuses the generator or submitter), `ClientNote`, `ClientRefund`, loans, settlements, payroll, `RuleRelease`, `EmployeeChangeRequest`. Pattern: `requestedBy/decidedBy` columns, status `PENDING/APPROVED/REJECTED`, checker must differ from maker |
| Audit log | `AuditLog` + `logAudit`; seals in `AuditSeal` |
| Settings | `PayrollRule`, `TaxRule`, `HrPolicy`, `PricingSetting` (the bureau's own margin target), per-service settings |
| Queries / tickets | `ClientQuery` + `ClientQueryMessage` (client portal questions to the bureau, with `firstResponseAt`, **no SLA clock**). **`RelationsCase`** is employee relations (grievances), nothing to do with clients |
| Data-subject requests | `DataAccessRequest`, `src/lib/data-requests.ts`, cron `data-retention` (export and retention already exist for employees) |
| Money | `Decimal(14,2)` / `Decimal(16,2)` columns; `src/lib/money-exact.ts` (branded `Kobo`, `mulPct`, `koboFromNaira`), `exact-fraction.ts` |

## 3. Mapping table

| CRM concept | Recommendation |
| --- | --- |
| **Account** | **Recommended: a new `CrmAccount` (prospects and clients as the sales side sees them) with a nullable `clientId` that links to the existing `Client` at handover.** Putting prospects into `Client` would add never-contracted organizations to every place that lists clients (payroll, billing, operations, reports) and would force `accountType` filters through all of them. The pack's other option, extending `Client` with `industry`, `accountType`, `ownerUserId`, `parentClientId`, `source`, `healthScore`, works too but touches core tables: **decision D5** |
| **Lead** | **New table `CrmLead`.** The existing `Lead` is the bureau's payroll-sales lead (own stages, segment, MRR, partner commission); different enough that extending it would break the bureau pipeline and its tests |
| **Contact** | **New table `CrmContact`** (there is `Client.contactPerson` as a single text field; no contact table exists) |
| **Opportunity** | **New table `CrmOpportunity`** |
| **Quote** | **New `CrmQuote` and `CrmQuoteLine`.** The existing `Proposal` quotes payroll packages per employee; the pack quotes guarding posts and shifts. Reuse only `proposal-pdf.ts` style and the below-margin approval idea |
| **Activity** | **New `CrmActivity`.** The existing `OutreachActivity` is the bureau's cold-call log; keep it as is |
| **Case** | **New `CrmCase`.** Not `ClientQuery` (portal payroll questions) and not `RelationsCase` (HR). The name `Case` is already taken twice, so the prefix matters |
| **SLA policy** | **New `CrmSlaPolicy`.** Nothing to reuse |
| **Pipeline, Stage** | **New `CrmPipeline`, `CrmStage`**, plus `CrmStageHistory` (append-only, same idea as `LeadStageChange`) |
| **Automation rule** | **New `CrmAutomationRule`, `CrmAutomationRun`**, with a due-time column polled by a new cron route (no queue exists) |
| **Consent** | **New `CrmConsent`.** No consent concept exists anywhere in the schema |
| **Handover** | **New `CrmHandover`**, creating `Client`, `Contract`, `ContractRate`, `Beat` through their existing services (section 5.F) |

Prefix every new model `Crm` (PascalCase, `cuid` ids, `organizationId`), matching the repository, instead of the pack's `crm_` snake_case.

## 4. Cost data access (for the quote builder)

**No existing function** returns the monthly employment cost per worker for a post type and shift pattern. What exists:

- `calculateEmployeePayroll` (pure, `src/lib/payroll/engine.ts`) turns a monthly gross and a salary structure into pay, employee pension, PAYE, **employer pension, ITF and NSITF** for one person.
- `buildQuickPayslip` (`src/server/services/quick-payslip.ts`) is a read-only calculator over a gross and a structure split (employee side: pension, PAYE).
- Employer add-on cost percentages (ITF, NSITF, insurance, uniform and kit, training, leave reliever, outsourcing allowance) are rule data; which apply depends on `Contract.businessLine`.
- `ContractRate` holds the **bill rate** per head per month for a category + structure, with the **70:30 operative share** (`operativeSharePct`).

Gaps: **shift pattern does not exist** (no 12-hour day/night/24-7 concept; billing is per head per month, lump sum, or per shift), and "post type" would be `EmployeeCategory`. A read-only `CostEstimator` composing the engine, the structure and the employer-cost rules is feasible **without touching the engine**, and must use the same rules and rounding as payroll (golden-tested against payroll for a few cases). **Not built; decision D2 on what "post type" and "shift pattern" mean.**

## 5. Conflicts and risks

**A. Money (`bigint` kobo vs the codebase).** The pack says all money is `bigint` kobo columns. `CLAUDE.md` rule 2 says "integer kobo **or exact decimals**"; the database stores `Decimal(14,2)/(16,2)`; the pay path computes in a branded `Kobo` number through `money-exact.ts`. A `bigint` column here would be a second money convention. **Recommend: `Decimal(16,2)` columns, computed in kobo with `money-exact.ts`, weighted value and margin rounded half up once in one shared function.** The pack's intent (no floats) is kept.

**B. Tenancy (row-level security).** The pack suggests RLS "for example". The repository has none and proves isolation per service. Adding RLS would be new infrastructure and a change to every connection. **Recommend: `organizationId` scoping as everywhere, with one isolation test per table.**

**C. Existing money lint exceptions.** `eslint.config.mjs` lists the existing CRM lib and service on the "inexact money allowed" exceptions list. The new CRM files must **not** be added to it; they must be exact from day one, as the pack requires.

**D. Roles are code.** The pack needs sales rep, sales manager, account manager, operations, finance, tenant admin. Today `Role` has `BUSINESS_DEV` (bureau only), `OPERATIONS`, `FINANCE`, `COMPANY_ADMIN`. New roles or a visibility model by owner and team is **an access-control change** (`CLAUDE.md` STOP list; critical module, needs your "go"). Owner-based visibility ("own leads, own accounts") does not exist anywhere yet.

**E. Feature flags do not exist** (rule 8). The CRM must ship OFF. Smallest honest option: a per-organization `crmEnabled` setting that gates the nav and every service. **Decision D6.**

**F. The handover (Phase 5) has no draft state to land in.** `Contract` has `DRAFT`; `Client` has none (ACTIVE, INACTIVE, SUSPENDED, CLOSED); `ContractRate` is effective-dated with no status; `Beat` has none. "Create them in DRAFT" would mean adding statuses to four core tables and teaching every list and the payroll and billing code to ignore drafts, which risks changing payroll behaviour (forbidden by the pack's own rule). **Recommend instead:** the `CrmHandover` row holds the **proposed bundle as data** (client, contract terms, rate lines, sites, strengths). A checker who is not the maker **approves it, and only then** are the real `Client`, `Contract`, `ContractRate` and `Beat` rows created, through their existing services (which already audit). Nothing is active before approval because nothing exists before approval, and no existing table changes. **Decision D5.**

**G. NDPA erasure versus the append-only audit log.** The audit log must not be edited, yet erasing a contact means the log may not keep their name. The mechanism (`redactAuditRows`, keyed proof, `AUDIT_REDACTION`) exists in #84, **not merged**. Until then: CRM audit entries should **carry ids and field names, not personal values** (a rule worth adopting from Phase 1). The pack's "before and after values" in the audit conflicts with this for personal fields.

**H. No delayed jobs.** Phase 6 and 7 need "after 3 days", "SLA warning at 75%", "renewal 90 days before". With only cron routes, the honest design is a table with a `dueAt` that a cron route polls (every 5 to 15 minutes), re-checks the item is still in the stage, and acts once (idempotency key). That fits the existing pattern and needs **no new dependency**. SLA warnings will be as accurate as the cron interval.

**I. Missing infrastructure the pack assumes:** SMS/WhatsApp APIs (not needed in v1 if links are used), file storage for survey photos and import files (needs a decision; CSV imports can be parsed from the request and not stored), a public-holiday calendar (only a weekday check `isWorkingDay` exists, in `payroll-reminders.ts`), a business-hours setting.

**J. Existing CRM vocabulary collides.** `crm.view`/`crm.manage` mean the bureau pipeline; `/api/crm`, `src/lib/crm.ts`, `src/server/services/crm.ts`, the nav entries and the sales dashboard are the bureau's. New code needs its own namespace (`src/lib/sales/`, `src/server/services/sales/`, permissions `sales.*`) so the two never share a file or a permission by accident. **Decision D1.**

**K. Unmerged dependencies.** 10 PRs are open. New migrations would be numbered after `20261105160000`. Nothing in the CRM needs them except audit redaction (G). Branch from `main`.

**L. Does anything force a payroll code change?** Not by design. Risks to watch: adding statuses to `Client`/`Contract`/`Beat` (F), a cost estimator that duplicates payroll rules instead of calling them (4), and rate-review automation reading effective-dated settings (it must read through the same `payrollRuleFor` / `taxRuleFor` functions payroll uses).

## 6. Proposed build order (adjusted from the pack)

The pack's order is sound; adjustments, with reasons:

1. **Phase 1 split in two.** **1a** (this order): `salesEnabled` setting, ownership/visibility model, `CrmPipeline`/`CrmStage`/`CrmStageHistory`, `CrmLead`, `CrmContact`, `Client` extensions, `CrmConsent`, seeds. **1b** (tables for quotes, cases, SLAs, automations) **moves into the phase that first uses each table**. Creating nine unused tables now breaks `CLAUDE.md` rule 9 (scope discipline) and invites rework.
2. **Consent moves to 1a and suppression to Phase 4.** No message of any kind should exist before the consent table does; the pack puts privacy last (Phase 9), which is too late.
3. **Visibility and roles (decision D3) move to 1a**, because every later screen filters by it. The Phase 9 role tests then become a matrix over what already exists.
4. **Phase 3 has two halves:** pipelines and Kanban first; the quote builder after the `CostEstimator` is designed and golden-tested against payroll (a mini-phase of its own, approved separately, because it reads pay rules).
5. **Phase 5 (handover)** follows decision D5; it is a critical module and goes to your independent reviewer.
6. **Phase 6 (automation)** needs the `dueAt` + cron design (H) and an idempotency table.
7. **Phase 7**: cases and SLA first, then renewals; **rate reviews after the estimator exists and only as proposals**; health score last.
8. **Phase 8** reports: after the data exists; test against a fixed synthetic dataset as the pack says.
9. **Phase 9** keeps NDPA export/erase and retention, reusing `data-requests.ts` where it fits; depends on #84 (G).

## 7. Decisions I need from you before Phase 1

| # | Decision | My recommendation |
| --- | --- | --- |
| D1 | Keep the bureau's existing sales pipeline untouched and build the pack's CRM beside it under a new `sales` namespace and `Crm*` models? | **Yes.** Later, the bureau may use the new module for its own sales (pack Appendix D); decide then |
| D2 | What are a **post type** and a **shift pattern**? (`EmployeeCategory` + a new shift-pattern list? A quote line = category + headcount + hours?) | Post type = `EmployeeCategory`; shift pattern = a small new list on the quote line only (no payroll change) |
| D3 | **Roles:** add sales roles to the fixed `Role` list, or add `sales.*` permissions to existing roles plus owner-and-team visibility? | Permissions on existing roles plus owner/team visibility; no new role until you want one |
| D4 | Money columns: `Decimal(16,2)` (codebase) or `bigint` kobo (pack)? | **`Decimal(16,2)`**, computed in kobo |
| D5 | **Handover and accounts:** (a) hold the draft bundle in `CrmHandover` and create real records only on approval, or add `DRAFT` statuses to `Client`, `ContractRate`, `Beat`? (b) is a **prospect** a separate `CrmAccount` linked to `Client` at handover, or a `Client` row with `accountType = PROSPECT`? | (a) bundle in `CrmHandover`; (b) separate `CrmAccount`. Together these leave payroll, billing and operations tables untouched. This is the biggest choice |
| D6 | **Feature flag:** per-organization `salesEnabled`, default off? | Yes |
| D7 | Approve the reconciled rules in section 8 before I append them to `CLAUDE.md`? | Yes, after edits |
| D8 | **Files:** survey photos and imports: allow only text/CSV and links in v1 (no storage), or choose a storage service (a new dependency and your approval)? | No storage in v1 |
| D9 | Is the first user of this module **a guarding company's own organization** (so the CRM lives inside client organizations, not the bureau)? | Yes, per the pack; confirm |

## 8. The pack's Part C, reconciled with `CLAUDE.md` (proposed text, NOT yet appended)

```
## CRM module rules (sales and account management)

Scope
- A module inside WorkforcePay, behind a per-organization setting that defaults to OFF.
  New code lives under src/lib/sales and src/server/services/sales, with models prefixed
  Crm and permissions prefixed sales. It never shares a file or permission with the
  bureau's own pipeline (crm.*).
- It NEVER modifies payroll calculation, statutory rules, payment files or posted payroll.
  It may READ costs through the same functions payroll uses. Operational records (client,
  contract, rate card, site) are created only on approval of a CrmHandover by a checker
  who is not the maker, through their existing services.

Money
- Money columns are Decimal(16,2); every calculation is done in whole kobo through
  src/lib/money-exact.ts (no floats, one rounding rule: half up, once). Monthly contract
  value is stored; annual value is derived. Weighted value = MCV x probability / 100,
  one shared tested function. New CRM files are never added to the lint exceptions list.
- Statutory rates and employer-cost percentages come from the effective-dated settings.

Data integrity and privacy
- Every table carries organizationId, every query is scoped to it, and every table has a
  cross-organization isolation test.
- Every create, update, stage change, conversion, merge, owner change and delete is audited.
  Audit entries carry ids and field names, not personal values (so erasure never conflicts
  with the append-only log).
- Soft delete by a status or voidedAt column; hard delete only through the erasure flow.
- Stage history is append-only. Phone numbers are stored as E.164 (+234...).
- Marketing consent per contact (unknown, granted, withdrawn) with source, time and
  evidence. No marketing message to anyone whose consent is not "granted". Service messages
  about an active contract are a separate, labelled category. Opt-out is one step and
  immediate. Consent wording and retention periods are reviewed by a lawyer.

Working method
- Tests first. One phase per session; each ends with the report template and an
  explain-back note, then stops. Migrations need your "go" and a reversible down.sql.
```

## 9. Out of scope for this report, left for later phases

Persona and permission matrix detail, screen designs, the exact default pipelines and SLA numbers (the pack's are kept as the starting point and marked "placeholder, edit me"), and every Appendix D item.

**Stop.** I will not start Phase 1 until you answer D1 to D9 (or say "use your recommendations").
