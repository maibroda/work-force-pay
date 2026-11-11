# HR governance, step 2: read-logging and the second-person rules

Written 2026-11-11. **A proposal only: nothing is built and no migration is written until you answer the questions in section 7 and say "go".** It is step 2 of `docs/plans/hr-governance-plan.md` (step 1, the Delegated HR Officer, is merged in #185). It is **access control and the audit trail, so it is a critical module**: the order, the tests and an explain-back note apply in full. I propose **two pull requests**: 2a (read-logging, no migration) and 2b (the second-person rules, one small migration).

## 1. Two things I found in the code that change the plan

I checked the code before planning, as CLAUDE.md asks, and two statements in the earlier governance plan were not right:

1. **A disciplinary sanction can be approved by the person who raised it.** The earlier plan listed disciplinary actions as "already enforced / check". I checked: `approveDisciplinary` (`src/server/services/hr.ts`) requires `hr.approve` and `discipline.manage` but **never compares the approver with the person who raised the record**, and the record stores only the raiser's **name** (`issuedBy`), not their user id. Any user who holds both permissions (a Company Administrator does) can raise and approve their own sanction. The comment says "maker/checker"; the code does not enforce it.
2. **Any relations case can be resolved and closed by the same person.** `closeCase` needs `hr.approve` ("a second pair of eyes") but does not check that the closer is not the person who resolved it, and the case does not store who resolved it (only the closer's name). Since step 1, a Delegated HR Officer holding the Welfare function can resolve **and** close a welfare case on their own.

And one thing that makes part of this **smaller** than I expected: **a read log already exists.** `recordSensitiveAccess` (`src/server/services/sensitive-access.ts`) writes who opened a person's bank, tax or pension details, guarantors, payslips or payment files, content-free, de-duplicated over 10 minutes, with a screen for auditors (Settings > **Who looked at sensitive details**). Step 2a **extends it** rather than building a second one (CLAUDE.md rule 1).

## 2. What exists today (verified 2026-11-11)

- **Read-logging:** payroll and personal-detail reads only. Welfare cases, succession, improvement plans, and confidential or disciplinary cases are **not** logged when read.
- **Maker and checker enforced in code:** probation (the appraisal's reviewer and signer cannot decide), improvement plans, training requests, promotions and recognition.
- **Not enforced:** disciplinary sanctions (above), closing any relations case (above), succession nominations (a successor is added in one step by one person: `setSuccessor`).
- **Welfare and succession rights:** `welfare.manage` and `succession.manage` are held by the HR administrator, and by a Delegated HR Officer through a live grant (step 1). `unheldFunctions` already knows who holds each function.

## 3. Step 2a: read-logging (no migration)

- **Five new kinds** in the existing log: **welfare case**, **confidential case** (harassment, whistleblowing, or any case marked confidential), **disciplinary case**, **succession** and **improvement plan**.
- **Logged inside the service that reads** (`getCase`, the lists, `successionOverview`, the improvement plan reader), not in each page, so **every caller is covered** and a new page cannot forget. As today: **not recording is not an option** (if the write fails, the read fails), **your own record is not logged**, and re-opening the same record within 10 minutes is one entry.
- **Content-free:** the entry carries the kind and the record's id, never text. For a list it carries the **count**.
- **What the auditor and the Company Administrator see.** For welfare, confidential and succession records the screen shows **who read it, when, the kind and the case number or role name, never the employee's name**: the fact that a named person has a welfare case is itself sensitive, and the existing screen names the employee. (Improvement-plan and disciplinary reads may show the name, because those lists are already visible to the auditor.)
- **External users are tagged** ("outsourced") on every entry, and an outsourced officer's reads are listed first (the step 1 plan promised this). The existing "unusual days" flag counts different people opened in a day, so it would need a small extension to count these reads (which carry no employee id).
- **No new permission:** the screen needs `audit.view`, as now.

## 4. Step 2b: the second-person rules (one small migration)

**The rule:** *the person who did the work does not also sign it off.* Each of the three is enforced on the server and tested.

1. **Closing a relations case.** The person who **resolved** the case does not **close** it. **Welfare cases** are the ones you named; I propose the **same rule for every case type**, because the code comment already says so and the gap is the same (question 5). The case stores who resolved it.
2. **Disciplinary sanctions.** The approver is not the person who raised the sanction. This is a **defect fix** for something the earlier plan believed was already true. The record stores the raiser's user id.
3. **Succession nominations.** A **new** successor is **proposed** by a holder of the succession function and counts only once a **different** holder **approves** it. Existing successors stay approved. Changing a successor's readiness and removing a successor stay immediate but are logged (question 7).

**The single-holder exception, so small companies are not stuck.** If the actor is the **only live holder** of the right needed (no other active HR administrator or officer with a live grant, the same test `unheldFunctions` uses), they may proceed **with a written reason (at least 20 characters)**. The record is **flagged "single holder"**, the reason is kept, and the flag shows on the record and in the auditor's view. It is **never** available when another holder exists. Nothing lets one person bypass the rule while a second person is available.

**Data (additive, reversible, round-tripped up/down/up on a copy of the seeded database):** on `RelationsCase`: who resolved (user id), whether the closure was single-holder, and its reason; on `DisciplinaryRecord`: the raiser's user id and a single-holder flag with reason; on `SuccessionCandidate`: a status (**a new enum**, default Approved so every existing row stays valid), who proposed, who decided and when, and the single-holder flag. **No existing enum value is added, so the down script only drops columns and the new type.** Existing records are not rewritten; a record raised before this change has no recorded raiser, and the rule simply does not apply to it (stated plainly in the explain-back note).

## 5. Permissions and audit

No new permission: the same people hold the same rights; the rule is about **who**, not **what**. Audit entries carry ids, the step and the single-holder flag, **never the reason text** (as for the Delegated HR Officer). The reasons and notes are personal text: they are added to the employee's copy of their data and removed on erasure, with tests, in the same change.

## 6. Tests first

2a: each of the five kinds writes one entry when read through every service entry point and none when the record is the reader's own; a failed write fails the read; the entry has no content; the same read within 10 minutes is one entry; the auditor's screen shows case numbers and role names and **no employee name** for welfare, confidential and succession; outsourced readers are tagged; another company sees nothing.
2b: the resolver cannot close (welfare and, if you agree, every case type); a different holder can; the single-holder exception needs a reason of 20 characters, is flagged, and is refused while another holder exists; the sanction's raiser cannot approve and another approver can; a record with no recorded raiser is unaffected; a proposed successor does not count in the overview, readiness, or "who is ready" until approved; the proposer cannot approve; existing successors still count; the rights are unchanged for every role; erasure removes the reasons; the audit log carries no text; the migration round trip keeps every row.

## 7. Questions for you (my recommendation in bold)

1. **Read-log the five kinds listed** (welfare, confidential, disciplinary, succession, improvement plan), content-free. **Yes.**
2. **The log shows case numbers and role names, never the employee's name,** for welfare, confidential and succession records. **Yes.**
3. **The Company Administrator and the auditor may read this log** (counts, kinds, case numbers; never content). **Yes**; or restrict it to the auditor?
4. **Welfare closure needs a second holder** of the welfare function, with the single-holder exception. **Yes.**
5. **Apply the same "resolver does not close" rule to every relations case,** not only welfare. **Yes**: this changes behaviour for a company with one HR administrator who currently resolves and closes alone; the single-holder exception covers them, with a reason.
6. **Disciplinary sanctions: the approver must differ from the raiser.** **Yes.** This fixes a gap the earlier plan thought was closed; your Company Administrator could previously raise and approve alone.
7. **Succession: only a new nomination needs a second person;** readiness changes and removals stay immediate but are logged. **Yes**; or should a readiness change also need approval?
8. **Existing successors count as approved** when this ships. **Yes.**
9. **The single-holder exception:** allowed only when no other active holder of the right exists, with a reason of at least 20 characters, flagged on the record and in the log. **Yes.**
10. **Two pull requests: 2a read-logging first (no migration), then 2b the second-person rules (one migration, needs your separate "go").** **Yes.**

## 8. Not in this step

The retention schedule, expiry notices and legal hold (step 3); a "break the glass" way to read a record with a recorded reason; notifications about an unusual read; logging of an employee reading their own record; extending a second person to rules that already have one or to payroll; any content in the log. **For your lawyer:** logging staff reads is personal data about staff (a privacy notice should say it), and the retention period of the read log itself belongs to step 3.

## 9. Order of work once you say "go"

**2a:** the pure rules and unit tests; the integration tests written to fail; the five kinds in the existing library and screen; the calls inside the services; docs, explain-back note, full suite, browser check with an officer, an auditor and another company; report. **2b** (after your "go" for its migration): the pure rules; the integration tests written to fail; the schema and migration round-tripped; the three rules and the exception; the pages that show who did what and the "single holder" flag; the data copy and erasure; docs, explain-back note, full suite, browser checks; report.
