# Review of the app, 2026-11-04: incomplete employee records, emergency contacts, and the list of pension fund administrators (plan)

**Status: a plan, for the founder's answers and "go". Nothing is built or changed by this document.** It answers three points from a review of the app: (1) incomplete employee records, including employees with two names, (2) emergency contact details, (3) where to add or remove a pension fund administrator (PFA). Employee data feeds payroll, so under `CLAUDE.md` anything that changes what an employee record must contain needs the founder's rule and "go", tests first, and an explain-back note.

## 1. What I found (checked in the code, 2026-11-04)

**Point 1: incomplete records.**
- **Two names are already allowed.** The middle name is optional in the database, in the form and in the import. A person with a first and a last name only is fine.
- **What blocks an import row today.** Four things are required: first name, last name, employment date, category. And **any value that is present but malformed also rejects the whole row**: an email that is not an email, an account number that is not exactly 10 digits, a date of birth that is not a date or is in the future, an unknown department, a gender that is not Male or Female, a bad annual rent. By default **no row is imported while any row has an error** (the page then offers to import only the right ones).
- **What is already tolerated** (a warning, the row still goes in): no bank details, no pension PIN or PFA, no tax ID, an odd phone number, an unknown state (left blank).
- **Editing exists.** An authorised HR person can edit an employee on the employee's page, so completing a record later is possible once the record exists. What is missing is a way to **get the incomplete record in**, and a **worklist of what is still missing**.
- **Why the four are hard.** Employment date and category are required columns of the employee record, and payroll depends on them (who is on the books in a period, how a person's pay is grouped). I will not fill them with invented values.

**Point 2: emergency contacts.** They **already exist**: a Contacts tab on each employee, the page "Next of kin and emergency contacts" (with who has none), self-service for employees, and an HR policy for how many of each are required. **What is missing is the bulk import**: the import template has no contact columns, so contacts for imported staff must be keyed one by one.

**Point 3: pension fund administrators.** There is **no list of PFAs anywhere**. The PFA is free text typed on each employee (and copied to each payroll record). So there is no place to add or remove one, and the same PFA typed two ways ("Stanbic IBTC Pension", "Stanbic Pension") becomes two PFAs in the pension schedules and remittances.

## 2. What I recommend, in order of risk

**A. A list of PFAs (point 3). Small migration, no payroll calculation change.** A settings page, "Pension fund administrators": add one, rename one, switch one off (never delete one that people are on). **Who:** the company administrator and HR manager (the same people who manage the other HR settings). Employees then **choose** their PFA from the list, and the import matches the PFA name to the list (a name that is not on the list is a warning and the PFA is left blank, not guessed). Existing employees' typed PFAs are turned into the starting list by the migration, so nothing is lost. Payroll and remittances keep using the PFA's name exactly as before.
**B. Emergency contacts in the bulk import (point 2). No migration.** Optional columns for an emergency contact (name, relationship, phone) and a next of kin, creating the same contact records the Contacts tab uses, with the same checks (a contact needs a phone number). Optional, and warnings, not errors.
**C. Let incomplete records in (point 1), in two steps.**
 1. **No migration, no payroll change:** a **malformed optional value no longer rejects the row**. It is left blank and reported as a warning with what was typed, so HR can correct it (for example "Account number '12345' is not 10 digits, so it was left blank"). Anything that is merely missing is already tolerated. The four required items stay required for now.
 2. **A "Records to complete" worklist (no migration):** one page listing every employee with what is still missing (date of birth, phone, bank details, pension PIN or PFA, tax ID, emergency contact and next of kin, and so on) with a link to edit, so HR can complete records as people hand in the information.
 3. **Only if you want the four required items relaxed** (question 2 below): that changes the employee record and payroll, and needs your rule first.

## 3. What this does not touch

No payroll calculation, no statutory rate, no payslip. A PFA's name still flows to the pension schedule exactly as typed on the list. Nothing is deleted: a PFA that is switched off stays on the employees who have it.

## 4. What I need from you

1. **The rejected rows.** Which message did the import show for the rows it refused? (The import page lists them row by row.) That tells me whether it was a missing required item or a malformed optional value, and step C1 may already be all you need.
2. **If a required item may be missing:** may an employee be saved **without an employment date, or without a category**? If yes, **what should payroll do with that employee until it is completed**: leave them out of the pay run with a visible warning (my recommendation), or something else? **I will not guess this: it is a payroll rule.** If you answer "leave out with a warning", I will propose the design (the record is flagged incomplete, shown on the worklist, and cannot be paid until completed) for your "go" before any migration.
3. **Single-name staff:** if a person has only one name on file, which field should hold it? (Today first and last are both required.)
4. **PFAs:** is the company administrator and HR manager the right pair to manage the list? Should a PFA also carry a short code or its PenCom number (optional)?
5. **Which contacts** should the import carry: emergency contact only, or next of kin as well?

## 5. If you say "go"

I would start **A, B and C1 and C2** (they need no payroll rule), tests first, one pull request each, and leave the required-items question (C3) until you answer 2 and 3.

## 6. The founder's answers of 2026-11-04, and what was found

- **The import's reason (question 1):** a screenshot of the import page showed "The file is missing required column(s): First Name, Last Name, Employment Date, Category" for a file called employee-import-template.csv. **So the rows were never judged: the file's header was not recognised.** The importer read only UTF-8 text split by commas; a file saved by Excel with semicolons, tabs, as UTF-16 or as Windows ANSI read as one cell. **Fixed** (see the release notes): the separator and encoding are now detected, and a title above the header is skipped. Whether any rows were then refused for missing or malformed values can only be seen once the file is read again.
- **PFAs (question 4):** yes, the company administrator and HR manager manage the list, **and each PFA carries a PenCom number** (optional field on the PFA). Not built yet.
- **Contacts (question 5):** the import carries **both** the emergency contact and the next of kin. Not built yet.
- **Still open:** question 2 (may an employee be saved without an employment date or a category, and what should payroll do meanwhile: my recommendation is to leave them out of the pay run with a visible warning) and question 3 (which field holds a single name). The remaining work (A: the PFA list, B: contacts in the import, C1: a malformed optional value as a warning, C2: the "Records to complete" worklist) waits for your "go".
