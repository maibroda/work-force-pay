# WorkforcePay — Data Protection Policy

**Status: draft, first pass.** This document describes what the platform actually does today,
honestly, including known gaps — it is not a claim of full NDPR compliance. Sections marked
**⚠ Gap** describe something that should be decided and built, not something already in place.

Last reviewed: 2026-10-06.

## 1. Scope

This policy covers personal data processed by WorkforcePay on behalf of the security, facilities,
cleaning, logistics and outsourcing companies ("the organization") that operate it. Under the
Nigeria Data Protection Act 2023 (NDPA) and the NDPR, the organization is the **data controller**
for its employees' and clients' data; WorkforcePay (the software) acts as a **data processor**.

## 2. Categories of personal data processed

- **Identity & contact**: name, gender, date of birth, phone, email, residential address.
- **Employment**: employee number, category, department, employment/exit dates, reporting line,
  deployment and movement history, work register (attendance/location) records.
- **Financial & statutory**: bank name/account/name, tax ID (TIN), pension PIN and PFA, declared
  annual rent (for tax relief), payroll history, PAYE/pension/ITF/NSITF remittance records.
- **HR records**: documents (ID, licenses, contracts, certificates — stored as metadata/references,
  not binary files), training/certification records, disciplinary records, onboarding/exit
  checklists.
- **Account security**: password hash (bcrypt, never plaintext), TOTP secret and backup code
  hashes when two-factor authentication is enabled, login history, audit trail (who changed what,
  when, and why).

No biometric or health data is currently collected.

## 3. Lawful basis for processing

Processing is necessary for the performance of the employment contract (payroll, deployment) and
for compliance with Nigerian statutory obligations (PAYE, pension, ITF, NSITF remittance;
employment record-keeping under the Labour Act). Client billing data is processed under the
organization's contract with its clients.

## 4. Retention

**Built — job applicants.** A rejected or withdrawn candidate's personal details (name, contact details,
CV reference, notes, interview comments) are anonymised once they have been out of the pipeline longer than
the retention period set in Settings → HR & Lifecycle Policy (24 months by default; 0 keeps everything). A
scheduled call to `/api/cron/data-retention` runs it daily and the same button can be run by hand. Hired
candidates and anyone still in the pipeline are never touched. The requisition, stage and offer figures stay
for reporting.

**⚠ Gap — employees.** Nothing purges an exited employee's records. Bank details, tax ID, pension PIN and
full history stay in the database indefinitely. Nigerian practice commonly references 6 years for
tax-relevant records (FIRS) and longer for pension records (PENCOM); no such schedule is implemented for
employee data. Until one is decided and built, treat "indefinite retention" of employee records as the
actual, current practice, not a documented policy choice.

## 5. Security measures in place

- **Access control**: role-based permissions checked server-side on every request
  (`src/lib/auth/permissions.ts`), re-checked at the service layer independent of the UI.
- **Audit trail**: every create/update/approval records who, when, old/new values, and — for
  sensitive actions — a documented reason (`AuditLog`).
- **Password storage**: bcrypt-hashed, never logged or stored in plaintext.
- **Login protection**: rate limiting with account lockout after repeated failed attempts
  (indistinguishable from a wrong password, so it can't be used to enumerate valid accounts);
  optional TOTP two-factor authentication with hashed one-time backup codes.
- **Two-factor by role**: an administrator (Settings → Users) picks the roles that must use two-factor and the
  first day it is compulsory. Before that day those users see a reminder on My security; from it, anyone in
  those roles who hasn't set it up can reach nothing but My security, and server actions are refused. Those
  users can't switch it off themselves. An administrator can reset a colleague who has lost their phone and
  backup codes (reason required, audited, their sessions end); never their own. It is off until someone sets it.
- **Change control on payment details**: bank, tax and pension details can require a second person's approval
  to change (maker/checker), and payroll validation warns after a recent bank change.
- **Session security**: signed, httpOnly, `secure`-in-production session cookies; a per-user
  session version that instantly invalidates every outstanding session on password change,
  logout-everywhere, or account deactivation.
- **Multi-tenancy isolation**: every organization-owned record carries an `organizationId`, and
  every query is scoped to it server-side.
- **Error handling**: unexpected errors are logged and reported (Sentry) without leaking internal
  details to the end user; expected business/permission errors show their real message since
  those are meant to be user-facing.
- **Exports**: CSV downloads neutralise spreadsheet formulas so a name like `=HYPERLINK(...)` can't run when
  opened in Excel.

## 6. Sub-processors

| Processor | Purpose | Data involved |
| --- | --- | --- |
| Sentry | Error tracking | Stack traces and request metadata. Before an event leaves the process (`src/lib/sentry-scrub.ts`, `src/lib/pii-scrub.ts`) cookies, auth headers, request bodies and query strings are dropped, the user is reduced to an id, and anything in error messages, breadcrumbs and extra data that looks like an email address, phone number, account/ID number or token is replaced with a placeholder. This is pattern matching: it removes too much rather than too little, but a name written in free text will not be recognised. |
| Resend | Transactional email (password reset, HR digest) | Recipient email address, reset link. Inactive until `RESEND_API_KEY` is configured. |
| [Hosting/DB provider — TBD] | Application hosting, database | All of the above, at rest. |

## 7. Data subject rights

**Built — access.** HR logs each request under HR → Data Access Requests (who asked, how, when it arrived),
records how identity was checked, and generates the person's data on the spot: a file covering everything held
on them, in plain language, with a checksum recorded. The file is never stored. The deadline is counted from
receipt (30 days by default, Settings → HR & Lifecycle Policy) and overdue requests appear in the HR digest.
Employees can also download their own data at any time under My Data. The file states what is left out and why:
interviewers' free-text feedback, confidential investigation records, other people's contact details, and system
logs.

**Built — correction.** Employees see their details under My Details and can ask for a change to bank, tax or
pension details, which a second person approves. Contacts and dependants they maintain themselves.

**⚠ Gap — erasure.** There is no tool for an erasure request outside the candidate retention job. Deleting an
employee's records is a manual database task and has to be weighed against the tax and pension retention
duties above, which usually override it for payroll data.

## 8. Breach notification

**Built — register and clock.** Every personal-data breach is logged under HR → Data Breaches with the moment
the company became aware, because the regulator's deadline (72 hours by default, Settings → HR & Lifecycle
Policy) is counted from then, not from when someone assesses it. A breach nobody has assessed yet is treated as
one that may need notifying, so it goes overdue on time. The digest email lists breaches that are unassessed,
due soon, or overdue.

The steps the system enforces:

1. **Log it** (HR). What happened, when it was discovered, what data and roughly how many people.
2. **Assess it** (someone with approval rights, with a written reason). *Unlikely to harm anyone* — no
   notification is owed, but the breach stays in the register. *Likely to put people at risk* — the regulator
   must be told. *High risk* — the people affected must be told as well.
3. **Tell the regulator** and record when, with their reference. After the deadline the reason for the delay is
   required. The breach page assembles the facts a notice asks for.
4. **Tell the people affected** (high risk only) and record how and what they were told.
5. **Contain and explain.** How it was contained, the cause, and what stops it recurring.
6. **Close.** Only when assessed, contained, explained and everyone who had to be told has been. A closed breach
   can't be edited.

Every step lands in an append-only timeline and the audit trail.

**⚠ Gap — people.** The system keeps the clock and the record; it doesn't decide who is on call. The company
still needs to name its data protection contact, put the regulator's notification address and procedure in its
own runbook, and decide who may assess a breach (today: anyone with HR approval rights).

## 9. Review

This document should be reviewed whenever a new category of personal data is introduced (e.g. a
future biometric attendance integration), whenever a new sub-processor is added, and at least
annually otherwise.
