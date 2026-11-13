# Explain-back note: governance step 2a, read-logging for the most sensitive records

For the founder. Plain language, payroll vocabulary. Plan: `hr-governance-step2-plan.md` (#188), part 2a. **This changes the audit trail, which is a critical module: please read it.** Built on your "go"; **you did not answer the plan's ten questions, so I used my recommended answers (listed at the end)**. No migration: the entries go in the existing audit log.

## What the code does, step by step

1. **The log already existed for payroll details** ("Who looked at sensitive details": bank, tax and pension identifiers, guarantors, payslips, payment files). It is extended, not duplicated. Each entry is: who, when, what kind, and the thing opened; **never the content**.
2. **Five new kinds are logged when read:** a **welfare case**, a **confidential case** (harassment, whistleblowing, or any case marked confidential), a **disciplinary case** (misconduct), the **succession list**, and an **improvement plan**. A plain grievance is none of these and is not logged.
3. **It is logged by the record, never by the employee.** The entry carries the **case's own id** (or the plan's), not the employee. On the auditor's screen it appears as **the case number** (for example "ER-00007") or a short plan reference. So the log cannot reveal that a named person has a welfare case or is on the succession list.
4. **It is written where the record is read, in the service, not on each page.** Opening a case, listing cases, opening the succession list, opening or listing improvement plans, and the **HR history on an employee's profile** (which shows each case's number, type and status) all write the entry, so a new page cannot forget. **If the entry cannot be written, the read fails and shows nothing** (the same rule as for payroll details).
5. **A list records how many, not who.** Opening a list of cases records, per kind, how many cases with content were shown ("3 welfare cases"). The succession list records how many successors.
6. **What is not a read.** Looking at a record **about yourself** is not recorded. A view that shows **nothing** (the auditor sees that a confidential case exists but not its content) is not recorded. Opening the **same record again within ten minutes** is one entry, as today.
7. **Outsourced readers are marked.** An outsourced officer's entries carry an "outsourced" mark, and the "By person" table lists outsourced readers **first**, so they are not lost among the busiest.
8. **A second "worth a second look" flag.** Besides 25 or more different employees' details in a day, **10 or more different records** (cases, plans, succession) in a day is flagged. Reading the same case thirty times counts once.
9. **Who can read this log:** the same people as today (those with `audit.view`: the auditor and the administrators). It shows who read what and when, never what was in it.

## A worked example

On Monday Ngozi, an outsourced officer holding the Welfare function, opens welfare case ER-00007, then ER-00009, then the list of welfare cases (3 shown). On Tuesday the auditor opens "Who looked at sensitive details": Ngozi is at the top, marked "outsourced"; the entries read "A welfare case, ER-00007", "A welfare case, ER-00009" and "The list of welfare cases: 3 welfare cases". **No employee is named and no case text appears.** Had Ngozi opened ten different cases in one day, the row would carry "unusual on that day". When Ngozi reads a case about herself, nothing is recorded.

## What could go wrong, and which test proves it does not

| Risk | Test |
| --- | --- |
| A read goes unrecorded | `tests/integration/record-read-log.test.ts`: each kind and each entry point (a case, a list, the HR history, the succession list, a plan, a plan list) writes one entry |
| The log names the employee or carries text | the same file: the audit rows and the auditor's screen are searched for the employee's name, id and the case and plan text |
| A failed write lets the read through | "not recording is not an option": the write is made to fail and the read fails and shows nothing |
| A person's own record or an empty view is recorded | the self-read and the auditor's hidden-content tests |
| Outsourced readers are lost | the marking and ordering tests, and the unit tests on the summary |
| Another company sees this | the tenant-isolation test |
| A page reads these tables directly and skips the log | I checked: no page or component reads them directly (they go through the services) |

## Assumptions (my recommended answers to the plan's questions)

1. The five kinds listed, content-free. 2. The log shows case numbers and plan references, **never the employee's name** (I applied this to improvement plans and disciplinary cases too: the plan said these "may" show the name; I kept them anonymous). 3. The Company Administrator and the auditor may read this log (it is `audit.view`, unchanged). 5. Outsourced readers are flagged and listed first.

## What I did not do or test

- **Not covered (findings, not built):** the **employee's data-access export** (a compiled copy of everything about one person, for a data request) reads cases and plans without going through these readers, so it is not logged; the **sanctions register** (the list of disciplinary sanctions, as opposed to disciplinary cases) is not logged; reads by the **employee's own manager** of a plan they own are logged like any other reader. Say if you want any of these added.
- **Second-person rules (2b)** are not part of this step and need their own migration "go".
- **Checked in a browser:** see the release notes entry and the report; anything not listed there was not checked on screen.
