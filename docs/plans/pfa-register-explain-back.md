# Explain-back note: the list of pension fund administrators (PFAs)

Branch `pfa-register`. One new table and its migration `20261121090000_pfa_register`. **No payroll calculation, statutory rate, payslip or payment file changes.** This touches access control (who may keep the list), a rule on employee records and change requests (an employee's PFA is held to the list), and audit.

## What it does, step by step

1. **A list per company.** Each company now has its own table of pension fund administrators: a name, an optional PenCom number (the regulator's licence number), and on/off. Until now the nine PFAs were a list written in the program, so nobody could add or remove one.
2. **Who may keep it.** The company administrator and the HR manager (the permission "configure HR", which only those two roles, and the platform super administrator, hold) may add a PFA, correct its name, record its PenCom number, switch it off or on, or remove it. Anyone who can see employees (payroll officers, HR, operations) can read the list. Everyone else, including employees themselves, cannot change it, and the check is made on the server, not just by hiding buttons.
3. **Each company sees only its own.** Every read and write is scoped to the caller's company. Another company's PFA is reported as "not found". The same name may exist in two companies.
4. **An employee's PFA is chosen from the list.** Once a company has a list, the PFA on an employee's record (when adding, editing, hiring from recruitment, or through a change request) must be on it and switched on. It is stored exactly as the list spells it, so "premium pension ltd" is saved as "Premium Pension Ltd" and the pension schedule never splits one PFA into two lines. A company with an empty list (none exists after the migration, but a new one could) can still type a PFA, as before.
5. **Nothing falls off.** An employee who already has a PFA that is later switched off keeps it, and can still be edited without losing it; they just cannot be moved onto a switched-off one. A PFA with employees cannot be removed: it can be switched off. A change request is checked twice, when it is made and again when someone else approves it, because the list may have changed in between.
6. **Renaming carries through.** Correcting a name changes it on this company's employees who have it, in one step, and says how many. A payroll already calculated keeps the spelling it was calculated with (the payroll record holds its own copy).
7. **The migration** gives every company that has no list the nine PFAs the form used to offer, **plus every PFA already typed on one of its employees** (once, whatever the capitals), so no employee's PFA is left off. `down.sql` removes the table (the PFAs stay on the employees, where they are stored).
8. **The bulk import** matches the PFA column to the list. A name that is not on the list, or is switched off, does **not** reject the row: the person is saved without a PFA and the row shows a warning saying where to add it. (This is the founder's rule that incomplete records must be capturable.)
9. **Audit.** Adding, changing, switching on/off and removing a PFA are logged with the PFA's id, its name (a company, not a person) and the names of the fields changed. No personal value is logged.

## Worked example

Company X has 24 employees on "Stanbic IBTC Pension Managers". The HR manager corrects the name to "Stanbic IBTC Pension Managers Ltd". The list shows the new name, the 24 employees now show it, and the page says "24 employees now show the new name". The pension schedule for the next payroll groups them under the new name. July's locked payroll still shows the old spelling.

## What could go wrong, and what proves it does not

| Risk | Test |
| --- | --- |
| Someone without the right role changes the list | `pfa-register.test.ts`, "who may keep the list": every other role is refused; payroll can read; an employee cannot |
| One company sees or changes another's list | "is each company's own" |
| A typed PFA splits one PFA into two schedule lines | "holds the employee to the list": stored as the list spells it |
| Switching a PFA off strips it from people | "lets an employee keep a PFA that has since been switched off" |
| A change request slips an off-list PFA through | "a change of PFA through a change request is held to the list too" (made and approved) |
| The migration drops someone's PFA | "the migration's own step": runs the migration's SQL on a rolled-back copy; the nine plus the typed one, once; an existing list untouched |
| The import rejects a row for a PFA | `employee-import-pfa.test.ts` |

## What I did not test, or did not do

- The migration was round-tripped (down, then up again) on the test database inside a transaction that was rolled back; I have not run it on a copy of production data (there is none).
- I changed three demo names in `prisma/demo-client.ts` ("ARM Pension" became "Access ARM Pensions", and so on) and one expected list in `tests/integration/acceptance-threeroots.test.ts`, because the demo import would otherwise leave those PFAs blank under the new rule. That is demo data, not a weakened check.
- The PenCom number is recorded for reference only. It is not validated and does not appear on the pension schedule yet (say if you want it there).
- Not in this change (separate pull requests, as agreed): emergency contact and next of kin columns in the import; malformed optional values (other than the PFA) becoming warnings; the "Records to complete" worklist.
