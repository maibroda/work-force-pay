# Explain-back note: governance step 5, two more reads in the access log

For the founder. Plain language. **This changes the audit log (access control and audit are critical modules). There is no migration, no new permission and no money.**

## What it is

You chose "log two more sensitive reads" from my list of open items. Step 2a made the audit log record who reads a welfare case, a confidential case, a disciplinary case, the succession list or an improvement plan, **by the record, never by the employee**. Two reads were left out, and this adds them on the same rule:

1. **The sanctions register**: the Disciplinary page's list of sanctions (queries, warnings, suspensions, termination recommendations) waiting for sign-off, with the people they are about.
2. **A data export for a data access request**: HR generates a person's whole file (bank, tax and pension details, cases, appraisals and the rest) to hand to them.

## What the code does, step by step

1. **Opening the sanctions register** writes one entry in the access log: who, when, the kind ("The sanctions register") and **how many sanctions were shown**. Never who they are about and never what they say. An empty register shows nothing, so it records nothing.
2. **Generating a data export** writes one entry **before anything is generated**: who, when, the kind ("A data export for a data access request") and the **request's own id**, which the auditor's screen shows as the **request number** (DSR-00001). Never the employee, their name or any of the file.
3. **Not recording is not an option, as in 2a:** if the entry cannot be written, the register does not open and the export is not made; the request is **not** marked as exported.
4. **Opening the same thing again within ten minutes is one entry**, as before. (The existing `DSAR_EXPORT` entry in the main audit log, which records every export with its checksum, is unchanged.)
5. **Reading your own is not recorded:** a person downloading their own copy of their data is not recorded, and neither is an HR person handling their own request.
6. **The auditor's screen** (Settings, "Who looked at sensitive details") lists both kinds with plain labels, shows the register as "N sanction(s)" and an export as its request number, counts both among the records a reader opened, and so flags a day of unusually many (10 or more different records), as it does for cases.

## A worked example

Tunde's Security Co. Obi (HR) opens the Disciplinary page, which shows three sanctions waiting for sign-off. The auditor's screen shows "Obi, 14:02, The sanctions register, 3 sanctions". Later Obi generates the data export for request DSR-00007. The screen shows "Obi, 14:20, A data export for a data access request, DSR-00007". Nobody reading the log can tell whose sanctions were on the page or whose file was exported, but they can see exactly who looked and when, and the request register says whose request DSR-00007 is.

## What could go wrong, and which test proves it does not

| Risk | Test (`tests/integration/record-read-log-exports.test.ts`, `tests/unit/sensitive-access-records.test.ts`) |
| --- | --- |
| A read is not recorded | "opening it writes one entry ...", "writes one entry by the request ..." |
| The log reveals who has a sanction or whose file was exported | the same tests: no name, no employee id, no text anywhere in the entry; the auditor-screen test |
| A failed log write lets the read or the export through | the two "if the entry cannot be written" tests (nothing shown; request not marked exported) |
| Refreshing floods the log | the two "within ten minutes" tests |
| Someone is recorded reading their own | "a person's own copy ... is not recorded" |
| A reader without the right gets in, or is recorded | "is recorded for the auditor too ... a reader without the right is refused" and "is refused to someone without the right, with nothing recorded" |
| Another company sees the entries | "each company sees only its own" |
| The existing export or log behaviour changed | `data-requests.test.ts`, `sensitive-access.test.ts` and `record-read-log.test.ts` pass unchanged |

## What I changed in an existing test, and findings

- **One existing test changed:** `tests/unit/sensitive-access-records.test.ts` pinned the list of record kinds at exactly five; it now lists seven. Every other assertion is kept.
- **Finding, not fixed:** the HR **history of one employee** (the timeline on their HR page) also shows that person's approved sanctions, and that read is **not** recorded (2a covered the cases in the timeline, not the sanctions). Say if you want it covered, by sanction id on the same rule.
- **Finding, not fixed:** the HR digest and the reminders read pending sanctions for the daily email; they run as the system and are not a person reading.
- **Browser check (demo app, signed in as the Company Administrator): opening the Disciplinary page wrote one entry (the sanctions register, 1 sanction, no employee, no text); the access-log screen lists both new kinds in its filter and shows the entry with its label and count. **Not browser-checked:** generating a data export for a request (covered by the integration tests) and the auditor role.
