# Field-level encryption: plan for decision

Status: **proposal, nothing built.** It needs four decisions from you (section 7), mainly about where the key lives, because that is the part that can lose data for good.

## 1. What problem this solves

Today every bank account number, tax ID and pension PIN sits in the database as plain text, and so does every TOTP secret. Anyone who gets a database dump, a backup file, a read-only database login or a stolen laptop with a `backups/*.dump` on it can read all of it without ever touching the application. Permission checks, masking and the new record of who looked do nothing against that. Encrypting the columns with a key that is *not* in the database means a stolen dump is unreadable.

It does **not** protect against someone who can run the application itself (they get the decrypted values like any user), so it complements the access controls and the audit trail rather than replacing them.

## 2. What would be encrypted

Found by searching the schema and code (about 143 uses in 31 files; no raw SQL touches these columns, and there are no database constraints, unique indexes or triggers on them):

| Where | Fields | Notes |
|---|---|---|
| `Employee` | `accountNumber`, `taxId`, `pensionPin` | The main stores. |
| `PayrollRecord` | `accountNumber`, `taxId`, `pensionPin` | Snapshots kept with every payroll, so a locked payroll shows what was true then. Many rows. |
| `PaymentTransaction` | `accountNumber` | |
| `User` | `totpSecret` | **Highest value per byte**: whoever holds it can generate valid sign-in codes. Recommend yes. |
| `Vendor` | `taxId`, `accountNumber` | Businesses, not people. Optional; recommend yes for consistency. |
| `EmployeeChangeRequest` | `proposed`, `previous` (JSON) | Plain copies of the same values. |
| `AuditLog` | `oldValue`, `newValue` when they hold these values | `employees.ts` writes the old and new bank, tax and pension values into the audit log on every change. **Left alone, this would keep a readable copy of everything we encrypt.** Fix: write masked values (last four characters) to the log, which is also better practice, because the log is read by more people than the employee record. |
| Backups (`backups/*.dump`) | everything above | Become unreadable automatically once the columns are encrypted. Restoring needs the key. |
| The organization's own `BankAccount.accountNumber` | | Not people's data and not secret in the same way (it is printed on invoices). Left out. |

## 3. How it would work

- **AES-256-GCM** (authenticated: a tampered value fails to decrypt instead of returning garbage). Stored as text in the same column, e.g. `enc:v1:<keyId>:<iv>:<tag>:<ciphertext>`, so no column types change. A value without the `enc:` prefix is treated as not yet encrypted, which is what makes the rollout safe (below).
- **Bound to its place.** The row id and column name are mixed in as associated data, so a ciphertext copied into another row or column fails to decrypt.
- **One data key per organization**, itself encrypted ("wrapped") with a master key. A client leaving the bureau can have its key destroyed, which makes its data unrecoverable even from old backups ("crypto-shredding"): a useful answer to erasure requests and to the retention rules we already have. The cost is a little more key handling.
- **Transparent to the rest of the code.** A Prisma client extension encrypts on write and decrypts on read for the listed fields, so the roughly 143 call sites do not change, and pages, payslips, the bank file and the portal keep working. Masking and permissions stay where they are.
- **Key rotation.** The key id is inside every value. A new key can be added, new writes use it, old values still read, and a background job re-encrypts the rest.
- **Errors.** If a value cannot be decrypted (wrong or missing key), the request fails loudly and is logged. It never silently shows blank or garbage, which would put wrong bank details in a payment file.

### Searching and duplicate checks

- `findDuplicates` and the import's duplicate check already compare values in memory, so they keep working unchanged.
- `conflictFor` (a change request whose number is already on someone else) queries by exact value. It would compare in memory after decrypting the organization's current employees, as the duplicate check does.
- `listEmployees` lets staff search by **part of an account number** (`contains`). That cannot work on ciphertext. Choices: (a) exact 10-digit match through a keyed hash column (HMAC) added for account numbers, or (b) drop the account-number search. Recommend (a): exact match, plus the last four digits already shown masked.

## 4. Rolling it out safely

1. Take a backup and prove it restores (existing `npm run db:backup`, `db:restore-check`).
2. Ship the code that can *read* both encrypted and plain values, with encryption switched off. Nothing changes.
3. Switch on writing encrypted values. New and edited records are encrypted; old ones still read.
4. Run the backfill: batches, idempotent (skips anything already encrypted), reads each value back and checks it before moving on, reports counts per table, and can be stopped and restarted. Nothing is deleted until a count of plain values reaches zero.
5. A test (and a check you can run against production) that scans the database for any value in these columns that does not start with `enc:` and fails if it finds one.
6. Change the audit writes to masked values, and mask the existing `AuditLog` entries. The audit log is now append-only at the database level (migration `20261030100000_audit_log_append_only`), so this one redaction has to say so explicitly inside its own transaction (`SET LOCAL wfp.allow_audit_redaction = 'on'`), and is recorded as its own audit entry.

Payroll records have no database trigger stopping updates, so the backfill needs no special bypass there.

## 5. Risks

- **Losing the key loses the data permanently.** This is the real cost. Mitigation: the master key is stored in two independent places you control (a password manager and a sealed offline copy), restoring a backup is rehearsed *with the key* as part of the existing restore check, and the key is never in the repository, the database or a backup.
- **Performance.** Decrypting is microseconds per value; the heaviest page (a bank list for a few thousand people) adds milliseconds. Payroll runs read these per employee, still small beside the calculation.
- **Anything that reads the database directly** (ad-hoc SQL, a BI tool, an old script) sees ciphertext. Today nothing in the repository does.
- **Old code paths that copy values into logs.** The scrubber (`pii-scrub.ts`) already removes account-number-shaped values from error reports; the audit-log change above closes the main remaining copy.

## 6. What it costs to build

About one working session of the same size as the earlier features: the crypto library with unit tests (tamper, wrong key, wrong row, rotation, prefix handling), the client extension, the backfill script with tests, the audit masking, the search change, a migration for the keyed-hash column and the per-organization key table, and the README and restore-check updates.

## 7. Decisions needed

1. **Where does the master key live?** An environment variable on the server (simple; whoever can read the server's environment can read the key), or a cloud key service (stronger: the key never leaves the service, access is logged; needs to be set up with whichever host you choose). Which host will run this in production?
2. **One key for everything, or one per client organization?** Recommend per client (crypto-shredding on exit).
3. **Scope.** Recommend: employees, payroll snapshots, payment transactions, TOTP secrets, change requests, vendors, and masking in the audit log. Say if you want it narrower.
4. **Account-number search.** Exact match only (recommended), or remove it.
