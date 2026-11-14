# Explain-back note: governance step 7, the sanctions on the employee's own profile page

For the founder. Plain language. **This changes the audit log (a critical module). No migration, no new permission, no money.** It follows step 6 (#200, merged) and closes the bigger gap I reported there.

## What it is

An employee's profile page has a **"Disciplinary" tab** that lists the person's sanctions with their descriptions (including a sanction still waiting for sign-off), and a **"Letters" tab** whose warning-letter buttons show each approved sanction's type and date. Neither read was recorded. Steps 5 and 6 recorded the sanctions register and the HR history; this records the profile page, on the same rule: **by the sanction's own id, never the employee, never the words.**

## What the code does, step by step

1. The profile page asks the employee service for the file. It now says **whether it is going to show sanctions**: only on the **Disciplinary** and **Letters** tabs.
2. For a person who may see discipline, on those two tabs, the service returns the sanctions **and records each one** (who, when, the kind, and the sanction's id). On every other tab **no sanction is returned and nothing is recorded** (praise still shows, as before).
3. **A caller that forgets to say** is treated as showing them, so a read is never missed by accident.
4. **Not recorded:** praise, a reader who may not see sanctions (they are returned none), and looking at **your own** profile.
5. **Opening the page again within ten minutes** is one entry per sanction. **If an entry cannot be written, the profile does not open.**
6. The auditor's screen shows each as "Sanction a1b2c3" (the step 6 reference), with no employee.

## A worked example

Obi (HR) opens Ada's profile on the **Overview** tab: no sanction is read, nothing recorded. He clicks **Disciplinary**: Ada has a written warning (approved) and a query still waiting for sign-off. The tab shows both, and the auditor's screen shows two new lines for Obi: "Sanction 7k3a9z" and "Sanction q2m8xc". Nothing says they are Ada's or what they say.

## What could go wrong, and which test proves it does not

| Risk | Test (`tests/integration/record-read-log-exports.test.ts`, the last describe) |
| --- | --- |
| A sanction shown is not recorded | "records each sanction it returns by the sanction's own id ..." |
| The log reveals whose sanction it is or what it says | the same test and the auditor-screen test |
| A page that is not showing sanctions still records, or still returns them | "a page that is not showing sanctions asks for none and gets none, and records nothing" |
| A reader without the right is recorded | "a reader who may not see sanctions is returned none, so records none" |
| Someone is recorded reading their own | "looking at your own profile is not recorded" |
| A failed log write lets the page through | "if the entry cannot be written, the profile fails and shows nothing" |
| Refreshing floods the log | "... opened again within ten minutes" |
| Another company's profile | "another company's employee is not found and records nothing" |

## What I changed in an existing test, and findings

- **No existing test changed.** None relied on the profile returning sanctions.
- **Behaviour change to know:** the profile now returns sanctions **only** to a page that asks for them. The only caller is the profile page, which asks on the two tabs that show them.
- **The Letters tab is recorded as a sanction read** even though it shows only the type and date, because that still tells the reader a sanction exists. Say if you would rather it did not.
- **Findings, not changed:** generating a warning letter reads a sanction's description (an act that is already audited); the HR digest and reminders read pending sanctions as the system, not a person; a probation recorded as failed can still be followed by a renewal; the retention leftovers.
