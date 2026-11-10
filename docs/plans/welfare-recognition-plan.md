# Welfare and recognition, step 1: welfare support requests and recognition awards

Written 2026-11-10. **A proposal only: nothing is built and no migration is written until the founder answers the questions in section 6 and says "go".** It is the next item in the founder's recorded order in `docs/plans/founder-decisions-2026-11-05.md` ("Learning & development, then welfare and recognition, then career and succession"). It is deliberately small, and it extends what exists (CLAUDE.md rule 1). **It handles no money:** anything that pays, or lends, an employee money stays in the existing payroll and loan processes with their approvals. Welfare information can include health and family matters, which is the most sensitive personal data a company holds; where that raises a legal question I say so and ask, and I assume no legal rule.

## 1. What exists today (checked in the code on 2026-11-10)

- **A confidential case system** (`src/server/services/relations.ts`): case types Grievance, Misconduct, Harassment, Whistleblowing, **Counselling**, **Mediation** and Other; severity, assignment, deadlines, notes, resolution; **some types are always confidential**; a confidential case's contents are shown only to people who manage HR cases, and read-only HR viewers see that it exists but not what it says; **an employee can raise their own grievance or concern** (`relations.raise`, "My grievances") and follow it. Erasure and the employee's data copy already cover cases.
- **Recognition in two forms, neither of which is a public award:** **continuous feedback** (built in #166: a private, dated note of Recognition or Coaching from a manager or HR, always visible to the employee), and a **commendation**, which is a disciplinary-record type that needs the same two-person approval as a sanction and sits on the employee's file.
- **Staff loans and advances** with their own approval and affordability rules, and **approved other earnings** (bonuses, allowances) through payroll.
- **Not there:** a way for an employee to ask for **welfare support** (bereavement, hardship, health and wellbeing, family or housing difficulty) that is handled as support, not as a grievance, with the sensitivity that needs; a **company recognition programme** (named awards such as Employee of the month, long-service awards, a safety award) with a nomination, an approval and a record; **long-service milestones** (nothing tells HR that someone reaches 5 or 10 years); and **engagement surveys** (not in this step: see section 5).

## 2. What step 1 adds

### A. Welfare support requests (extends the case system)

1. **A new case type, "Welfare support"**, always confidential. An employee raises it themselves under **My grievances** (renamed **My cases and support** in the menu so it is not mistaken for a complaint), or HR raises it on the employee's behalf at their request.
2. **A kind**, chosen from a short fixed list: **Bereavement, Financial hardship, Health and wellbeing, Family, Housing or transport, Other**. The kind helps HR route and count; it does not change the rules.
3. **Handled by a smaller group than other cases.** A new permission, **`welfare.manage`** (HR administrator and the administrators), is needed to read or work a welfare case; **someone who can read other confidential cases but does not hold it sees only that a welfare case exists**, never who or what. The auditor sees the count, not the content.
4. **Notes, assignment, status and resolution work exactly as for other cases.** HR may record the **support offered** in plain words ("referred to the staff counsellor", "time off agreed"). **If money is involved** (an advance, a loan), HR raises it through the existing **staff loans and advances** process with its own approval; a welfare case may note that it was raised but **does not approve, pay or promise anything**.
5. **Counts without names:** a small page for the HR director shows how many welfare cases were raised in the year by kind, with no names (and nothing at all when fewer than 5 fall in a group, so a person cannot be identified).

### B. Recognition awards

1. **Award types the company sets** (Settings): a name (Employee of the month, Safety star, 5 years' service), a description, whether it is a **long-service** award (and for how many years), and whether it **may be announced** to staff. The company starts with none.
2. **A nomination:** a person's **manager** (about a direct report) or **HR** (about anyone) nominates an employee for an award type with a **citation**: a few plain sentences saying why. **Nobody nominates themselves.**
3. **A second person approves** (the same approval right HR uses for other approvals, `hr.approve`, never the nominator). Approving records the award with the date; rejecting needs a reason.
4. **The employee sees it** (**My recognition** under My HR): the awards they have received, with the citation. **It is never announced to others unless the award type may be announced and the employee has agreed** (question 6).
5. **A recognition board (optional, off by default):** for award types that may be announced, an approved award the recipient agreed to can appear on a page every employee can read, showing the name, the award and the citation, newest first.
6. **Long-service milestones:** a list for HR of employees reaching **a milestone anniversary** (the company sets its own years, for example 5, 10, 15, 20) in the next 60 days, computed from the employment date, **to prompt a nomination; never an automatic award**.

## 3. The rules in plain terms (with a worked example)

- **Separate things stay separate:** a private **feedback** note (Recognition) stays; a **commendation** on the file (disciplinary area, approval) stays; an **award** is the formal, approved, optionally announced recognition. None creates another.
- **Welfare is confidential by construction:** the server refuses everyone without `welfare.manage` the contents of a welfare case, in every list, search, export and digest; it never appears in the HR digest or reminders with a name or a kind.
- **Awards cannot be self-nominated and need a second person.** A rejected or withdrawn nomination stays on record with its reason; an approved award is never edited (a correction is a withdrawal with a reason and a new award).
- **Worked example (welfare):** a guard's mother dies. He raises a welfare case, kind Bereavement, from his phone under My cases and support. The HR administrator sees it, assigns herself, agrees five days' compassionate leave with him and notes "leave agreed" as the support offered. He asks about an advance on his salary; she tells him to apply through staff loans, which goes through its own approval. She closes the case. The company administrator (who holds `welfare.manage`) can read it; the payroll officer and the auditor see only that a welfare case exists. **Worked example (recognition):** the supervisor nominates a guard for "Safety star" with the citation "Reported a damaged fire exit at the client's site and stayed until it was secured". The HR administrator, not the nominator, approves it. The guard sees it under My recognition and, because he agreed, it appears on the recognition board.

## 4. Files, migration, permissions and tests (once approved)

- **Migration (additive, reversible, round-tripped on a copy of the seeded database):** one value on the case-type enum (`WELFARE`), one nullable kind column on cases, tables `RecognitionAwardType` and `RecognitionAward`, a few enums, and one column on the employee record or the award for the agreement to be announced. No existing column changes meaning.
- **Pure functions first** (`src/lib/recognition.ts`, `src/lib/welfare.ts`): who may nominate whom, the milestone anniversaries coming up, the small-group rule for the counts, the status moves of an award. **Unit tests first.**
- **Extend, do not duplicate:** welfare reuses the existing case service, its notes and its self-service raising; only the extra permission check and the kind are new.
- **Permissions (new):** `welfare.manage` (HR administrator, company and super administrators). Awards use `hr.manage` to nominate (HR) and the existing manager link for a manager, and `hr.approve` to approve. The employee needs no permission to see their own recognition.
- **Tests (integration, written first):** a welfare case's content is refused to everyone without `welfare.manage` (HR reader, finance, payroll, auditor, supervisor) in lists, detail and search; the employee sees only their own; another company sees nothing; counts hide groups smaller than 5; a loan is never approved or created from a case; nobody nominates themselves; a manager nominates only a direct report; the approver is never the nominator; a rejected award needs a reason and stays on record; the employee sees only their own awards; the board shows only announced awards the recipient agreed to; the milestone list follows the company's own years and creates no award; the audit log carries ids and field names only.
- **Personal-data rules (learned from earlier steps):** welfare case text and award citations go into **the employee's copy of their data** and are **removed on erasure** (the shape and the audit log stay), with tests, in the same change.
- **Documents:** release notes, the data dictionary (regenerated), an explain-back note.

## 5. What is not in this step

**Engagement and pulse surveys** (they need their own anonymity design: a minimum group size, no identifiable answers, and a decision on how guards without a smartphone take part), **welfare programmes and budgets** (an employee assistance programme, a welfare fund), **any cash or gift value on an award** (a money award is "other earnings" with tax treatment: it goes through payroll under your rules), **peer nomination**, **notifications**, and any change to how loans, advances or leave work.

## 6. Questions for the founder (my recommendation in bold)

1. **Welfare through the existing case system**, as a new always-confidential type "Welfare support" with a short fixed list of kinds? **Yes** (it reuses notes, assignment, self-service and erasure). The alternative is a separate module.
2. **Who may read a welfare case?** **Only people with a new `welfare.manage` right (HR administrator and the administrators),** narrower than other confidential cases. Is that the right group, or should it follow the existing confidential-case rule?
3. **The law:** a welfare case can hold **health and family information, which is sensitive personal data**. **Please have your lawyer review the wording and the retention before a company uses this for real employees.** I will not write legal advice into the screens.
4. **Money:** **none in step 1.** Help with money stays in staff loans and advances with their own approvals. A welfare fund or a cash award is a separate decision for you (and your adviser on tax).
5. **Recognition award types:** set by each company, none provided, with an optional "long-service" years setting. **Right?** Who may nominate: **a manager (direct reports) and HR**, not peers.
6. **Announcing an award:** **off by default; only for award types that may be announced, and only if the recipient agrees.** Is the recipient's agreement needed, or may the company announce by default?
7. **Approval:** **a second person (`hr.approve`) approves every award.** Too heavy for a small award such as a monthly one?
8. **Long-service milestones:** the company sets its own years; HR gets a list to prompt a nomination, **never an automatic award.** Right?
9. **Engagement surveys:** a **separate step 2**, once you have decided the anonymity rules (minimum group size, how site guards answer). **Agree?**
10. **The menu:** rename "My grievances" to **"My cases and support"** so an employee does not feel they must make a complaint to ask for help. **OK?**

## 7. Suggested order of work once you say "go"

One pull request with one migration: (1) the pure rules and their unit tests, (2) the schema and migration, (3) the welfare case type and permission with integration tests (confidentiality first), (4) awards (types, nominations, approval, my recognition, the board, milestones), (5) the counts page and the menu rename, (6) the data-copy and erasure coverage, (7) docs, the explain-back note and the full suite, (8) browser checks with an employee, HR, a payroll officer and the auditor, and a report.
