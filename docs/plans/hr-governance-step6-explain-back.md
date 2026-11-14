# Explain-back note: governance step 6, sanctions in an employee's HR history

For the founder. Plain language. **This changes the audit log (a critical module). No migration, no new permission, no money.** It finishes the job step 5 started.

## What it is

Step 5 recorded the sanctions **register** (the Disciplinary page's list) and data exports. It left one more place where sanctions are shown: **an employee's HR history**, the timeline on their HR page. It shows each **approved sanction with its description** ("written warning, the guard left his post ..."), and that read was not recorded. You chose to cover it.

## What the code does, step by step

1. When someone opens an employee's HR history, the history shows the employee's **approved sanctions** (queries, warnings, suspensions, termination recommendations) to people who may see discipline, as before.
2. **Each sanction shown is now recorded** in the access log: who, when, the kind and the **sanction's own id**. **Never the employee and never what the sanction says.** On the auditor's screen it appears as a short reference ("Sanction a1b2c3"), like an improvement plan.
3. **What is not recorded:** praise (a commendation is not a sanction and shows to everyone), a sanction still waiting for sign-off (the history does not show it), reading **your own** history, and a reader who may not see sanctions (the history shows them none, so there is nothing to record).
4. **Opening the history again within ten minutes** is one entry per sanction (as for every other kind).
5. **Not recording is not an option:** if an entry cannot be written, the history does not open.
6. The auditor's screen counts these among the **records** the reader opened, so a day of unusually many (10 or more different records) is flagged, as for cases.

## A worked example

Obi (HR) opens Ada's HR history. She has a written warning and a suspension on record, both approved, and a commendation. The history shows all three. The auditor's screen shows two new lines for Obi: "A disciplinary sanction, or the sanctions register: Sanction 7k3a9z" and another for the suspension. Nothing in them says it was Ada's, or what the warning said. The commendation is not recorded.

## What could go wrong, and which test proves it does not

| Risk | Test (`tests/integration/record-read-log-exports.test.ts`, the last describe) |
| --- | --- |
| A sanction shown is not recorded | "records each sanction it showed by the sanction's own id ..." |
| The log reveals whose sanction it is or what it says | the same test (no name, no employee id, no words) and the auditor-screen test |
| Praise or a pending sanction is recorded | the same test |
| A reader who cannot see sanctions is recorded | "a reader who may not see sanctions is shown none, so records none" |
| Someone is recorded reading their own | "looking at your own history is not recorded" |
| A failed log write lets the history through | "if the entry cannot be written, the history fails and shows nothing" |
| Refreshing floods the log | "opening the history again within ten minutes is one entry ..." |
| Another company sees it | "another company's auditor sees none of it" |
| Existing behaviour changed | the existing timeline, discipline, welfare, succession, letter and read-log tests pass unchanged |

## What I changed in an existing test, and findings

- **No existing test changed.** The label of the "sanction" kind was reworded ("A disciplinary sanction, or the sanctions register"); no test pinned the old wording.
- **Finding, not changed:** generating a **warning letter** from a sanction reads the sanction's description to fill the letter. That is an act (the letter is generated and kept), not browsing, and the letter generation is already audited; I did not add a read entry. Say if you want one.
- **Finding, not changed (a bigger one I found while checking this in the browser):** the employee's own profile page has a **"Disciplinary" tab** that lists that person's sanctions (with their descriptions) and is read through the employee record itself, not through the history. **That read is not recorded.** It is the same kind of gap, but it is rendered by the page, so it is a separate change; say if you want it covered.
- **Browser check (demo app, Company Administrator):** opening the Lifecycle timeline tab of an employee with an approved sanction wrote one entry (the sanction's id, no employee, no text), and the access-log screen shows it as "Sanction waplav" with no employee. **Not browser-checked:** the auditor and finance roles (covered by the integration tests).
- **Findings from before, still open:** a probation recorded as failed can still be followed by a renewal of that contract; the retention leftovers (re-clearing late records, the 90-day window for surveys and applicants, measuring the access logs).
