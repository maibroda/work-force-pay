# Explain-back note: employee master data in the audit log (masked)

Decided by the founder on 2026-11-19: "last 4 digits + changed fields". Files: `src/lib/audit-mask.ts` (the rule, pure, no database), `src/server/services/employees.ts` and `src/server/services/change-requests.ts` (where it is used). Tests: `tests/unit/audit-mask.test.ts` (10) and `tests/integration/master-data-audit.test.ts` (7).

**What it does, step by step**
1. Whenever an employee is created or edited, or a bank, tax or pension change is requested or approved, the code compares the old and new details field by field.
2. It writes ONLY the fields that changed, and sorts every field into one of three kinds:
   - **Numbers** (bank account number, tax ID, pension PIN): written as the last four characters, for example `****6789`. A number of four characters or fewer is written as `****`.
   - **Plain** values: the employee number, status, state of residence, employment and exit dates, the NHF flag, category, department, reporting manager, client and beat, and the names of the bank and the pension administrator. These do not identify the person on their own, so they are written as they are.
   - **Everything else is personal**: names, date of birth, phone, email, address, account name, declared rent, gender. Only the NAME of the field is written (in a list called `changedFields`), never the value.
3. A field the code has never heard of is treated as personal, so a column added later cannot leak by default.
4. The employee record and the change request keep every full value. Only the audit entry is masked.

**Where each rule comes from.** CLAUDE.md rule 5 (bank, tax and pension details "masked in logs") and the audit-log principle used in #219 to #228: the log is append-only and cannot be reached when a person is erased, so it must not hold their words or details.

**Worked example.** HR requests a bank change for a security guard: from First Bank, account `0123456789`, account name "ADA OBI" to Zenith Bank, `2099999999`, "ADA C OBI". The log records: before `{bankName: First Bank, accountNumber: ****6789}`, after `{bankName: Zenith Bank, accountNumber: ****9999, changedFields: [accountName, accountNumber, bankName]}`, with the reason and who did it. An auditor can see the account moved from one ending 6789 to one ending 9999 and that the account name changed, but not the names or the full numbers.

**What could go wrong.** (1) Two different accounts ending in the same four digits would look alike in the log: the change request and the employee record still hold the full numbers, and `changedFields` still shows a change happened. (2) A reason typed by a person is still written as typed (it is the justification for the change); it is not masked. (3) Entries written before this change still hold the full details, because the log is append-only.

**Tests that prove it.** The unit tests prove the rule (last four, short numbers, personal fields by name, unknown fields as personal, dates and amounts compared by value). The integration tests prove each entry (create, edit, bank request, bank approval, tax and pension, a direct edit with change control off), that none of the synthetic details appear anywhere in the log, and that the records still hold them.
