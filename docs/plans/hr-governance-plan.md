# HR governance: delegated HR officer, role separation, access logging and retention policy

Written 2026-11-10. **A proposal only: nothing is built and no migration is written until the founder answers the questions in section 6 and says "go".** It turns the founder's decisions of 2026-11-10 (`docs/plans/founder-decisions-2026-11-10-hr.md`) on companies without an HR administrator, role separation and retention into a build plan. It is **access control and personal data, so it is a critical module**: the order, the tests and the explain-back note apply in full. Parts are independent, so it is split into steps (section 5).

## 1. What exists today (checked in the code)

- **Roles are fixed** (`SUPER_ADMIN`, `COMPANY_ADMIN`, `HR_ADMIN`, and the others). Welfare (`welfare.manage`) and succession (`succession.manage`) are held by `HR_ADMIN` **only**, withheld from the two administrators. **A company with no `HR_ADMIN` has nobody who can read a welfare case or keep a succession list.**
- **Maker and checker** already exist for improvement plans, probation (the appraisal's reviewer and signer cannot decide), promotions, recognition and training requests. **Not for** welfare case closure or succession nominations.
- **Audit:** changes are logged by ids and field names. **Reads** (viewing) of sensitive records are not logged.
- **Retention:** an employee retention period in years (HR policy) and **erasure** of free text on request, keeping the shape and the audit log; candidate retention in months. **No per-record-category schedule, no expiry notices, no legal hold.**
- **Configurable policy:** HR policy holds appraisal, probation, PIP, training and other numbers as settings (the founder's "configurable policies" point is largely met).

## 2. What this adds

### 2.1 The Delegated HR Officer (and an outsourced HR administrator)
- A **role "Delegated HR Officer"** (`HR_OFFICER`), **appointed by the Company Administrator**, holding **only the permissions the Company Administrator explicitly assigns** from a fixed list of HR functions (for example: read and work welfare cases, run surveys, keep succession). Nothing is inherited from `COMPANY_ADMIN`.
- **Welfare cases can be assigned to the officer.** **Sensitive welfare records never become visible to the Company Administrator** because they appoint someone: the administrator holds no welfare right, as today.
- **Succession stays disabled until an authorised HR role exists** (an `HR_ADMIN`, or an officer who was assigned that function). A banner tells users that certain HR functions need an authorised officer.
- An **outsourced HR administrator** is an `HR_ADMIN` or `HR_OFFICER` user who is not an employee of the company (an external consultant): the account is flagged "external", time-limited (an end date), and **every read of a sensitive record by an external user is logged**. Appointing and removing them is audited.

### 2.2 Role separation on sensitive transactions
The founder's rule: **no one initiates, approves and independently audits the same sensitive transaction.** Applied to: probation decisions and improvement plans (**already enforced**), disciplinary actions (**check**), and the two not yet covered:
- **Welfare case closure:** the person who worked the case proposes the closure; **a second person with the welfare right confirms it** (when the company has only one such person, the closure is allowed with a recorded reason and flagged "single officer").
- **Succession nominations:** a nominator proposes and **a different authorised person approves** a successor entry before it counts (the same single-officer exception).

### 2.3 Access logging for the most sensitive records
Reading (not only changing) a **welfare case, a succession entry, an improvement plan or a disciplinary or confidential case** writes an audit entry (record id, who, when) with **no content**. The auditor can see the log of reads, never the content.

### 2.4 A retention policy that is data, not code
- A **retention schedule per record category** (employee file, appraisals, probation, feedback, improvement plans, disciplinary, training and evaluation, skills, welfare, succession, raw surveys, anonymised survey reports, audit logs, unsuccessful applicants, access logs), each with a period, a trigger (after exit, after closure, after the record's date) and an action (**delete** or **anonymise**). **The founder's proposed defaults are loaded but marked "unverified"**, with a field "legal adviser verified on and by", exactly as statutory settings are handled (the founder's own rule).
- **Expiry notifications** to the authorised HR role (a list of what is about to expire).
- **Legal hold:** a record, an employee or a whole category can be placed on hold with a reason and an end review date; **a hold suspends deletion**; releasing it is audited.
- **Deletion is audited** (category, counts, run date, who authorised it); **no HR administrator can bypass** the schedule or a hold: running a deletion needs the Company Administrator's separate confirmation (a second person), and **blocked entirely for an unverified schedule in production** unless the company accepts it in writing on screen.
- It **reuses** the existing erasure function (free text removed, shape kept) for "anonymise", and a new hard delete only for categories the schedule says to delete.

## 3. The rules in plain terms (with a worked example)

- **Worked example:** Tunde's Security Co. has no HR administrator. The Company Administrator, Adaeze, appoints Ngozi (an HR consultant from outside, flagged external, appointment ends 31 March) as a Delegated HR Officer with "work welfare cases" and "run surveys" but **not** succession. An employee raises a bereavement support request: Ngozi can read it, Adaeze cannot. Succession shows "Needs an authorised HR officer" until Adaeze also assigns that function. When Ngozi proposes to close the welfare case, **a second welfare-right holder must confirm**; with only Ngozi, the closure needs a reason and is flagged "single officer". Every time Ngozi opens the case, an audit entry (no content) is written. Months later the retention screen lists 14 improvement plans expiring in 30 days; one belongs to a person under a **legal hold**, so it is skipped; Adaeze confirms the rest, and the run is audited by counts.

## 4. Files, migration, permissions and tests (once approved)

- **Migration (additive, reversible, round-tripped):** a role value for the officer (an enum value, which Postgres cannot drop, so the down script recreates the enum as in the welfare migration), a per-user permission-assignment table, an external flag and end date on the user, and tables for the retention schedule, legal holds and retention runs. **Destructive deletion is only ever performed by the retention run, behind the rules above.**
- **Tests first:** an officer holds only assigned permissions and nothing inherited; the Company Administrator cannot read a welfare case or assign themselves the right silently (assigning is audited); succession is refused until an authorised role exists; the second-person rule on welfare closure and on succession nominations, and the single-officer exception; every read of a sensitive record logs an entry and never content; an external user's access ends on the end date; a hold suspends deletion; a deletion needs the second confirmation and is audited; an unverified schedule blocks a production run; erasure and anonymise reuse the existing function; tenant isolation.

## 5. Suggested steps (each its own plan-approved build)

1. **Delegated HR Officer and assigned permissions**, with the "needs an authorised officer" banner and the external-user flag. (Smallest and unblocks small companies.)
2. **Read-logging and the second-person rules** for welfare closure and succession nominations.
3. **The retention policy module** (schedule, notifications, legal hold, audited runs), once the lawyer has seen the defaults.

## 6. Questions for the founder (my recommended answer first)

1. **Is the Delegated HR Officer a new role with a fixed list of assignable functions** (not a free-form permission editor)? **Recommended: yes**, a fixed list, so a company cannot create a role the audit story does not cover.
2. **May the Company Administrator assign the welfare and succession functions to an officer?** **Recommended: yes**, but assigning is audited and the administrator never gains the right themselves.
3. **A second person to confirm a welfare closure and a succession nomination, with a single-officer exception?** **Recommended: yes**, so small companies are not blocked.
4. **Should reads of welfare, succession, improvement-plan and confidential cases be logged?** **Recommended: yes**, without content, visible to the auditor.
5. **Outsourced HR administrator: an external user with an end date and read-logging?** **Recommended: yes.**
6. **Retention defaults loaded as "unverified" and blocked in production until the lawyer verifies them?** **Recommended: yes**, the same way statutory settings are treated.
7. **Who confirms a retention run: the Company Administrator separately from the HR administrator?** **Recommended: yes** (a second person).
8. **Legal hold: any HR administrator may place one; only the Company Administrator may release it?** **Recommended: yes.**
9. **Which step first?** **Recommended: step 1** (the officer role), then step 2, then step 3 after the lawyer.

**Risks:** more roles mean more ways to mis-assign access: the safeguards are the fixed function list, audited assignment, read-logging and the second-person rules. A lawyer should review the retention defaults, the legal-hold wording and the external-user arrangement (a processor agreement).
