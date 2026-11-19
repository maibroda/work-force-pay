# Plan: older audit rows that still hold the words (a one-off clean-up, run later)

Written 2026-11-19 for the founder. **Status: the direction is chosen (a plan now, a tested clean-up routine later, run only on your approval); nothing is built.** This plan changes no code, no data and no setting.

## 1. Why this exists

From #219 to #231 every new audit entry carries ids, numbers, statuses and field names only, never the words (requisitions, recruitment, hire pay, contracts and probation, relations cases, sanctions, exits, settlements, employee master data, onboarding steps). **Rows written before those fixes still hold the words**, because the log is append-only. The log is read by the administrators and the auditor and cannot be reached when a person is erased.

**Where the old rows are today:** I believe only in demo and test data, because the host is not chosen yet and no company has gone live. **Please confirm that no real company's data is in any database that the app has run against.** If that is right, the clean-up is a go-live checklist item, not an emergency, and a company that starts on the fixed code never has old-shape rows.

## 2. What already exists (so nothing is invented)

`redactAuditRows` in `src/server/services/audit-seal.ts` is the one sanctioned way to change audit rows on purpose. In one transaction it lifts the database's append-only rule for that transaction only, changes the rows, and writes an `AUDIT_REDACTION` entry listing each changed row with its new content hash and a keyed proof. The tamper check (`verifyOrganization`) accepts exactly those changes and nothing else. It needs the `settings.manage` right and a written reason of at least 10 characters. It was built for this kind of job (its own comment says "for example masking account numbers when field encryption is rolled out").

**One gap:** it can change `oldValue`, `newValue` and `metadata`, **not the `reason` column**. Some old rows hold free text in `reason` (a waived step, a returned or cancelled settlement, an exit-task waiver, and the `reason` written on some approvals). Clearing those needs a small extension of this function, which is a **critical audit file** and, today, **not in CODEOWNERS** (decision 3 below).

## 3. What the routine would do

For each company, on request, in this order:
1. **Dry run first (changes nothing).** Count the old-shape rows per action and show you a few redacted examples with the words hidden, so you can see exactly what would change.
2. **A backup is taken and checked before anything is written** (CLAUDE.md rule 7: no rewriting of production data without a documented backup and your approval). The routine refuses to run without a recorded backup reference.
3. **Rewrite each old row into the shape the code now writes**, using the same rules the code uses today so the old and new rows look alike:
   - Whole-record rows (requisitions, candidates, offers, contracts, cases, sanctions, exits, onboarding steps, settlement lines) keep only the fields the current entry carries (the id, number, type, status, dates, flags). Everything else is removed.
   - Employee master data rows (`EMPLOYEE_CREATE`, `EMPLOYEE_UPDATE`, the bank, tax and pension change rows and `CHANGE_REQUEST`) are rebuilt with the masking rule (`maskedChange`): changed fields only, last four of a number, personal fields by name only.
   - Free text in the `reason` column of the actions listed in section 2 is cleared (needs the extension).
4. **One `AUDIT_REDACTION` entry per batch**, with the written reason, so the clean-up is itself on the record, and the seal check is run after and must report no findings.
5. **Idempotent:** a row already in the new shape is left alone, so running it twice changes nothing the second time.

## 4. Questions for you (my recommendation first; none is assumed)

- **O1. Run it when?** *Recommended:* **not now.** Put it on the go-live checklist and run it only if a company's data was ever created on the old code. *Alternative:* run it on the demo data now (it only tidies synthetic rows).
- **O2. Does the `reason` column count?** *Recommended:* **yes**, clear it for the listed actions, with the small extension of `redactAuditRows`. *Alternative:* leave `reason` as it is and clean only `oldValue` and `newValue` (less change to a critical file, but some old free text would remain).
- **O3. CODEOWNERS for the audit seal files.** *Recommended:* add `src/lib/audit-seal.ts` and `src/server/services/audit-seal.ts` before touching them, so the change needs your review (they are not listed today). Needs your word, because it changes who must review code.
- **O4. Who may run it?** *Recommended:* only the platform administrator, one company at a time, on a written request from you, never from a screen in the app. *Alternative:* a button for the Company Administrator (more convenient, a larger risk).
- **O5. Keep the old text anywhere?** *Recommended:* **no**; the backup is the only copy, held under the backup rules, and is destroyed on the normal schedule. The point is that the words leave the log.

## 5. Tests to write first (when this is built)

- A row in each old shape becomes the new shape and carries none of its words (one test per action family).
- The dry run changes nothing.
- The seal check (`verifyOrganization`) reports no findings after a clean-up, and **reports a finding if someone changes the same rows by hand without the declared redaction**.
- Running it twice changes nothing the second time.
- It refuses without a backup reference, without the right, with a short reason, and for another company's rows.
- The `reason` column is cleared for the listed actions and left alone for every other.

## 6. Risks

- **It rewrites rows in a table that is protected on purpose.** The existing redaction path is the control; the plan adds no new way around the protection.
- **A clean-up cannot be undone** except from the backup. Hence the dry run, the backup check and your approval.
- **Rows may have been copied elsewhere** (a report someone exported earlier). The clean-up cannot reach those.
- **Entries from a spread or multi-line audit call that the scan missed** would still hold words; the dry run is the place they would show up.

## 7. What I did not do

Nothing is built or changed. No audit row has been touched. No data was read beyond the code.
