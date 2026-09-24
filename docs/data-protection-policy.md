# WorkforcePay — Data Protection Policy

**Status: draft, first pass.** This document describes what the platform actually does today,
honestly, including known gaps — it is not a claim of full NDPR compliance. Sections marked
**⚠ Gap** describe something that should be decided and built, not something already in place.

Last reviewed: 2026-09-24.

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

**⚠ Gap — current state, stated honestly**: the application does not purge any personal data
today. An exited, terminated, or resigned employee's bank details, tax ID, pension PIN, and full
history remain in the database indefinitely, with no automated retention/purge job.

This should be revisited with an explicit retention schedule — Nigerian practice commonly
references 6 years for tax-relevant records (FIRS) and longer for pension records (PENCOM), but no
such schedule is implemented in code today. Until a retention job exists, treat "indefinite
retention" as the actual, current practice — not a documented policy choice.

## 5. Security measures in place

- **Access control**: role-based permissions checked server-side on every request
  (`src/lib/auth/permissions.ts`), re-checked at the service layer independent of the UI.
- **Audit trail**: every create/update/approval records who, when, old/new values, and — for
  sensitive actions — a documented reason (`AuditLog`).
- **Password storage**: bcrypt-hashed, never logged or stored in plaintext.
- **Login protection**: rate limiting with account lockout after repeated failed attempts
  (indistinguishable from a wrong password, so it can't be used to enumerate valid accounts);
  optional TOTP two-factor authentication with hashed one-time backup codes.
- **Session security**: signed, httpOnly, `secure`-in-production session cookies; a per-user
  session version that instantly invalidates every outstanding session on password change,
  logout-everywhere, or account deactivation.
- **Multi-tenancy isolation**: every organization-owned record carries an `organizationId`, and
  every query is scoped to it server-side.
- **Error handling**: unexpected errors are logged and reported (Sentry) without leaking internal
  details to the end user; expected business/permission errors show their real message since
  those are meant to be user-facing.

## 6. Sub-processors

| Processor | Purpose | Data involved |
| --- | --- | --- |
| Sentry | Error tracking | Request metadata, stack traces. A `beforeSend` hook (`src/lib/sentry-scrub.ts`) strips session cookies and auth headers before an event leaves the process; it does not yet scrub arbitrary PII that might appear in a logged error's message or stack (e.g. an email address in an error string) — review case by case as errors occur. |
| Resend | Transactional email (password reset) | Recipient email address, reset link. Inactive until `RESEND_API_KEY` is configured. |
| [Hosting/DB provider — TBD] | Application hosting, database | All of the above, at rest. |

## 7. Data subject rights

**⚠ Gap**: there is no self-service data export or erasure tooling yet. Access, correction, and
erasure requests currently require a database administrator to act manually. This should be
tracked and formalized (a documented SLA and, ideally, a self-service or semi-automated path)
before this policy can be called complete.

## 8. Breach notification

**⚠ Gap**: no formal incident response runbook exists yet. At minimum, a breach affecting personal
data should be reported to the organization's data protection contact and, where required by the
NDPA, to the Nigeria Data Protection Commission, within the statutory window. This needs an owner
and a written runbook, not just this paragraph.

## 9. Review

This document should be reviewed whenever a new category of personal data is introduced (e.g. a
future biometric attendance integration), whenever a new sub-processor is added, and at least
annually otherwise.
