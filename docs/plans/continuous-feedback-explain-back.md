`# Explain-back note: continuous feedback
`
`Branch `continuous-feedback`. One migration, `20261130090000_continuous_feedback` (additive: one enum, one table). This adds **who may write a note about whom, what an employee can see, and what a reviewer can read**, so it touches access control and personal data: please read it. Built on your "go" of 2026-11-07 to the plan `docs/plans/continuous-feedback-plan.md`. **You did not answer the plan's eight questions, so I used my recommended answers; they are listed under "Assumptions" below and each is easy to change.**
`
`## The rules, step by step
`
`1. **An entry** is a short note (5 to 1,000 characters) about one employee: a **kind** (Recognition or Coaching), the text, and the day it is about (today unless said, never in the future). Who wrote it is recorded.
`2. **Who may write about whom.** Nobody about **themselves**, HR included. **HR** (`feedback.manage`) about anyone. Anyone else with `feedback.give` (supervisors, operations managers) **only about their own direct reports**: the person must name them as their reporting manager. For anyone else the server answers only "Employee not found", so a manager cannot find out who else works here. Only an **active** employee (or one on leave) can be written about.
`3. **The employee always sees it.** Under **My feedback** they see every entry about them that has not been voided, and who wrote it. There are **no private notes about a person's performance**. They may add **one reply** to each entry (never to someone else's, never twice); the manager and HR can read it.
`4. **Nothing is edited or deleted.** HR **voids** an entry made in error with a reason (at least a few words); the entry is kept with who voided it, when and why, and leaves the employee's page and the default lists. A manager cannot void.
`5. **Who reads what.** HR reads everyone's entries (with filters by employee number, kind and dates). A manager reads only their direct reports' (**My team's feedback**; this is also what HR sees on that page, for their own direct reports). Finance, payroll, the **auditor**, and an employee through the HR pages are refused.
`6. **On an appraisal** the reviewer (the employee's manager) and HR see the entries dated **inside the cycle's period** (both its first and last day), as a read-only panel. **Nothing in feedback changes a rating, a score or a recommendation.** The employee does not see this panel; they read their own entries under My feedback. Anyone else (another manager, the auditor, another company) gets nothing.
`7. **Personal data.** An employee's entries and replies are part of the **copy of their data** they can ask for (never a voided entry). When an employee is **erased**, the words in every entry, reply and void reason are removed; the shape stays (that an entry existed, its kind and date) and the audit log is untouched.
`8. **Audit.** Writing, replying and voiding are logged by **ids and the kind only**: never what a note, a reply or a reason says.
`
`## A worked example
`
`On 12 November a supervisor (the guard's reporting manager) records **Recognition**: "Stayed on after the shift to hand over the keys properly to the late relief." On 20 November she records **Coaching**: "Two of this week's incident reports were missing times; use the template on the radio card." The guard sees both under My feedback and replies once to the second: "I had no pen; I have one now." The supervisor tries to record Coaching about a guard who reports to another supervisor: the server says "Employee not found" and nothing is saved. HR notices the 20 November entry was meant for another guard: HR voids it with the reason "Entered about the wrong guard"; it disappears from this guard's page but stays on record. In March the guard's appraisal opens: the reviewer sees the 12 November entry and the reply in the "Feedback in this period" panel while rating, and decides the ratings themselves.
`
`## What could go wrong, and what proves it does not
`
`| Risk | Test |
`| --- | --- |
`| A manager writes about, or reads, someone who is not their direct report | `feedback.test.ts` (unit, `mayGiveFeedback`) and the integration tests: another manager's report, a person with no manager and another company's employee are all "not found"; a manager lists only their own reports |
`| Someone writes feedback about themselves | the self tests, for a manager and for HR with an employee record |
`| Private notes: the employee cannot see something recorded about them | the employee-view tests: everything not voided is visible, with the author; the reply is visible to the manager and HR |
`| An entry is edited or deleted, or a mistake is hidden without trace | voiding needs a reason and keeps the row (counted in the test); no function edits an entry |
`| A role that should not read feedback does (auditor, finance, payroll, the employee through the HR pages) | the role tests: each is refused on every read and action |
`| Feedback changes an appraisal, or leaks to the wrong reader | the appraisal tests: only entries dated inside the period, only for that employee, only for the manager and HR; the appraisal row is unchanged afterwards |
`| The audit log carries what a note, reply or reason says | the audit test searches every \`FEEDBACK_*\` entry for each secret phrase |
`| Words survive an erasure, or are missing from the employee's copy of their data | the privacy tests: the export includes entries and replies (not voided, not anyone else's); the erasure removes every word, keeps the shape and leaves the audit log untouched |
`| The migration loses data | round trip (up, down, up) on a copy of the seeded database: employees unchanged, schema identical |
`
`## Assumptions (my recommended answers to the plan's questions; change any of them)
`
`1. **The employee always sees feedback recorded about them.** 2. **Only the reporting manager and HR give it** (no peers or clients). 3. **Two kinds only**, Recognition and Coaching, separate from a formal commendation (which stays a disciplinary-area record with approval). 4. **Direct reports only** (not a chain of command). 5. **The auditor does not read it.** 6. **No editing; HR voids with a reason** (the author cannot void their own entry). 7. **Read-only evidence on an appraisal, never a score.** 8. **Roles that give feedback:** HR, the administrators, supervisors and operations managers; each also needs a login linked to an employee record.
`
`Smaller choices I made that you did not ask for: **HR's "My team's feedback" page shows only their own direct reports** (their everyday view is the Feedback page); the **employee's reply is one per entry and not editable**; **a voided entry still appears to HR when they choose "show voided"**, with its reason; and an entry about **someone who has since left** stays readable, but a new one cannot be written.
`
`## What I did not do or test
`
`- **Checked in a browser against the test database** with the supervisor (recorded Recognition about a direct report, with its audit row; the same form about someone who does not report to them saved nothing), the employee (saw the entry and its author, replied once; the audit holds only ids) and HR (the page showed the entry, the reply and a Void button), and over HTTP the role access (the auditor, the employee and the supervisor are refused on the pages they should not reach). My feedback fits at phone width. **Not seen in a browser:** HR voiding an entry, the HR filters, the appraisal panel, and the exact words of the "not found" message on screen (the integration tests assert it).
`- **Not built:** peer or client feedback, requests for feedback, email or SMS notifications, a link from an entry to a KPI or criterion, any analytics, and a manager chain (a manager's manager).
`- Nothing was added to **demo data** and the **smoke test** is unchanged (no new detail pages).
