# CRM Phase 1a plan: foundation (settings, accounts, contacts, leads, consent, visibility)

**Status: BUILT on branch `feature/crm-foundation` (founder's "go" 2026-10-29), not yet merged.** The screens add and list only; editing, voiding and reassigning are service-only so far. It adds a migration (rule 7) and new permissions (an access-control change, `CLAUDE.md` STOP list), so it waits for your "go". It follows `docs/crm/00-audit.md`, with your answers D1 to D9 taken as my recommendations (below).

## 1. Decisions as settled ("use your recommendations", 2026-10-29)

| # | Settled as |
| --- | --- |
| D1 | New module beside the bureau's pipeline: `Crm*` models, `src/lib/sales`, `src/server/services/sales`, permissions `sales.*`, routes `/sales`. The bureau's `crm.*`, `/crm`, `Lead`, `Proposal` are not touched |
| D2 | Post type = `EmployeeCategory`; shift pattern = a small list on the quote line only (Phase 3) |
| D3 | No new roles. New `sales.*` permissions granted to existing roles, plus owner and team visibility |
| D4 | Money columns `Decimal(16,2)`, computed in kobo through `money-exact.ts` (no money in Phase 1a) |
| D5 | Handover bundle held in `CrmHandover`, real records created only on approval (Phase 5); prospects are a separate `CrmAccount` that links to `Client` at handover |
| D6 | A per-organization switch, **off by default** |
| D7 | The reconciled rules in section 8 of the audit are appended to `CLAUDE.md` **in this phase's PR**, so you review them as a diff (not appended before) |
| D8 | No file storage in v1: text, CSV and links only |
| D9 | The first users are guarding-company organizations; the bureau may switch it on for itself later |

## 2. What Phase 1a builds (and what it leaves for later)

**Builds:** the switch; accounts, contacts, leads (create, edit, list, view, assign an owner, soft-void); consent records; E.164 phone handling; owner/team visibility; audit; the screens for these; seven test groups.
**Leaves for Phase 2:** duplicate detection, merge, lead conversion, assignment rules, CSV import/export. **Phase 2 also creates** the pipelines, stages, opportunities and stage history (their first use is conversion), so no empty tables are made now.

## 3. Migration `20261106090000_sales_foundation` (reversible, with `down.sql`)

Every table has `id` (cuid), `organizationId`, `createdAt`, `createdBy`. Names, not personal values, go in the audit log.

- **`CrmSetting`** (one per organization): `enabled` (default false), `mode` (CLASSIC | SIMPLE, default CLASSIC), `updatedBy`, `updatedAt`.
- **`CrmAccount`**: `name`, `normalizedName`, `industry`, `accountType` (PROSPECT | CLIENT | FORMER_CLIENT), `ownerUserId`, `parentAccountId`, `source` (REFERRAL | WALK_IN | PHONE | WEBSITE | WHATSAPP | TENDER | EVENT | EXISTING_CLIENT | OTHER), `sourceDetail`, `state`, `lga`, `address`, `rcNumber`, `emailDomain`, `clientId` (nullable link to `Client`, set only at handover), `status` (ACTIVE | VOID), `voidedAt`, `voidedBy`.
- **`CrmContact`**: `accountId` (nullable), `firstName`, `lastName`, `jobTitle`, `roleInDecision` (DECISION_MAKER | INFLUENCER | USER | FINANCE | PROCUREMENT | GATEKEEPER), `phoneE164`, `whatsappE164`, `email`, `isPrimary`, `ownerUserId`, `status`, `voidedAt`.
- **`CrmLead`**: `number` (gap-free, `nextNumber`), `companyName`, `contactName`, `jobTitle`, `phoneE164`, `email`, `industry`, `state`, `lga`, `address`, `source`, `sourceDetail`, `estimatedGuards`, `serviceInterest` (GUARDING | CLEANING | FACILITY | STAFFING | OTHER), `status` (NEW | CONTACTED | QUALIFIED | UNQUALIFIED | CONVERTED), `unqualifiedReason`, `ownerUserId`, conversion links (null until Phase 2), `voidedAt`.
- **`CrmConsent`** (append-only, by database trigger like the audit log): `contactId` or `leadId`, `purpose` (MARKETING | SERVICE), `status` (GRANTED | WITHDRAWN), `channel`, `source`, `evidenceRef`, `recordedBy`, `recordedAt`. The current status is the latest row; **none means "unknown", which blocks marketing**.

No existing table is changed. Indexes: every list filter (organization + owner + status, phone, email, normalizedName).

## 4. Permissions and visibility (an access-control change)

New permissions: `sales.view` (own records), `sales.view.all`, `sales.manage` (create, edit, assign, void), `sales.configure` (the switch, mode).

| Role | Gets |
| --- | --- |
| COMPANY_ADMIN | all four |
| OPERATIONS | `sales.view.all` (read, for handover planning) |
| FINANCE | `sales.view.all` (read) |
| BUSINESS_DEV | `sales.view`, `sales.manage` (own records and anyone's they own or are assigned) |
| Everyone else | nothing; the nav entry and every service refuse |

**Team visibility** (a manager sees their reps) is not in 1a: there is no team structure yet. 1a gives "own" and "all"; teams come with the sales-manager question in Phase 2 or 3, as you choose. Every service call checks, in this order: switch on for this organization, permission, then visibility (own vs all). Server-side only; the UI is not a control.

## 5. Other pieces

- **Phone** `normalizeNgPhone` (pure): `0803...`, `234803...`, `+234 803 ...`, `(0803) 123-4567` all become `+2348031234567`; anything else is refused with a message, never guessed.
- **Audit** actions `SALES_ACCOUNT_*`, `SALES_CONTACT_*`, `SALES_LEAD_*`, `SALES_CONSENT_RECORD`, `SALES_SETTING_UPDATE`, carrying ids and the names of changed fields only.
- **Screens** under `/sales`: Leads, Accounts, Contacts, Settings (the switch). Nav entry only when the switch is on and the role has `sales.view`.
- **`CLAUDE.md`**: the reconciled section is appended in the PR.

## 6. Tests first (they fail before the code)

1. Phone normalisation (the four formats, rejects, non-Nigerian number refused).
2. Switch off: every service refuses, the nav entry is absent, nothing is created.
3. Permission and visibility matrix per role (own vs all; AUDITOR, EMPLOYEE, CLIENT_APPROVER see nothing).
4. **Cross-organization isolation for every table** (A cannot read, edit, void or link B's rows; a contact cannot be linked to another organization's account).
5. Audit rows exist for each action and contain no name, phone or email.
6. Consent is append-only (update and delete refused by the database), the current status is the latest row, no row means unknown.
7. Gap-free lead numbers; voiding hides a record from lists but keeps it; a converted lead is read-only (guard only; conversion is Phase 2).

## 7. Risks and what I will not do

- A new permission set is an access-control change: your reviewer should read it.
- A trigger on `CrmConsent` makes erasure a Phase 9 decision (it will need the same keyed-redaction route as the audit log, from #84, which is not merged).
- I will not touch `Client`, `Contract`, payroll, billing, the bureau's `crm.*`, or any payroll code. No new dependency.

**Please say "go" (or give changes) and I will write the tests first, then the code.** I would branch `feature/crm-foundation` from `main`. Your pension work is still uncommitted on `pension-due-date`; tell me to commit it (or leave it) before I switch branches.
