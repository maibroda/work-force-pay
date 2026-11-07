# Performance management, step (c): continuous feedback

Written 2026-11-07. **A proposal only: nothing is built and no migration is written until the founder answers the questions in section 6 and says "go".** It is item 4(c) in the build order of `docs/plans/founder-decisions-2026-11-05.md` (job descriptions and KPIs are done in #157; the structured PIP is built in #164; then continuous feedback; then the probation review). Where I propose a rule it is a proposal for the founder to confirm. Feedback about a person is personal data and can affect how they are treated, so the visibility rules in section 3 matter more than the screens.

## 1. What exists today (checked in the code on 2026-11-07)

- **Appraisals** (`src/server/services/appraisals.ts`) are formal and periodic: ratings against criteria, a recommendation, sign-off by a second person. Between cycles there is nowhere to record how someone is doing.
- **Commendations** exist, but only as a **disciplinary-record type** (`COMMENDATION`) that needs the same maker and checker approval as a sanction. That is right for a formal commendation on someone's file; it is far too heavy for "well handled at the post today".
- **A reporting-manager link exists** on the employee record (`reportingManagerId`), already used to pick appraisal reviewers. A manager is an employee, and a user of the system only if they have a login.
- **Not there:** any lightweight, dated note of praise or coaching about an employee, any way for the employee to see or answer it, and any way for a reviewer to see what happened during the period when writing an appraisal.

## 2. What this step adds

1. **A feedback entry**: about one employee, written by one person, with a **kind** (**Recognition**: something done well; **Coaching**: something to improve, with what would help), the text, and the date it relates to. Short by design (a few sentences).
2. **Who may give it:** the employee's **reporting manager** and **HR** (a person who manages feedback). A person can never give feedback about themselves. (Peers and clients are not in this step: see question 2.)
3. **The employee always sees it.** There are **no private notes about a person**: anything recorded about an employee's performance is visible to that employee, who may add **one reply** to each entry. This is deliberate (see section 3).
4. **Entries are not edited.** A mistake is corrected by **voiding the entry with a reason** (HR), never by deleting it; the voided entry is kept, marked, and not shown in lists by default.
5. **It feeds the appraisal as evidence, never as a score.** On an appraisal the reviewer and HR see a read-only panel "Feedback in this period" (the entries dated inside the cycle's period). **Nothing in feedback changes a rating or a recommendation automatically**, as with KPIs and recommendations today.
6. **Screens:** HR > Performance management > **Feedback** (everyone's, with filters by employee, kind and dates, and the form to give one); **My team's feedback** for a manager (their direct reports only, with the form); **My feedback** for the employee (entries about them, and the reply box).

## 3. The rules in plain terms (with a worked example)

- **Why the employee always sees it:** if coaching can be recorded privately and later used in a review or a plan, the employee never had the chance to put it right or to disagree. Visible entries make the later formal steps fair, and they protect the company. The employee's reply is kept with the entry.
- **Who sees an entry:** the employee it is about; their reporting manager; HR. Another employee never does. A manager sees only their **direct reports** (one level; not a whole chain of command: question 4).
- **A manager cannot give feedback about someone they do not manage**; HR can about anyone. The server checks this on every request, not only on the screen.
- **No effect on pay, status or discipline.** Feedback is a note. A formal commendation or sanction still goes through the Disciplinary area with its approval; a PIP still goes through its own two approvals. A plan or an appraisal may **mention** feedback; it is never started by it.
- **Worked example:** on 12 November a supervisor (the guard's reporting manager, with a login) records **Recognition**: "Stayed on after the shift to hand over the keys properly to the late relief; the client noticed." On 20 November she records **Coaching**: "Two of this week's incident reports were missing times; use the template on the radio card." The guard sees both under **My feedback** and replies to the second: "I had no pen; I have one now." In March, the appraisal's reviewer sees both entries (and the reply) in the "Feedback in this period" panel while rating, and decides the ratings themselves.

## 4. Files, migration, permissions and tests (once approved)

- **Migration (additive, reversible, round-tripped on a copy of the seeded database):** one table, `PerformanceFeedback` (company, employee, author's user id and name, kind, text, the date it relates to, the employee's reply and its time, voided at / by / reason), one enum for the kind. No existing table changes.
- **Pure functions first** (`src/lib/feedback.ts`): whether a person may give feedback about an employee (manager of, or HR, never themselves), whether an entry falls inside an appraisal period, the length limits. **Unit tests first.**
- **Services and screens:** `src/server/services/feedback.ts`; the three pages above; the panel on the appraisal page. Each page declared in `entry-modules.ts` (module `hr`; the employee's page `self_service`) and in the navigation.
- **Permissions (new):** `feedback.give` (a person who may write feedback; **proposed grants: HR administrator, company administrator, super administrator, supervisor and operations roles**, each limited to their own direct reports unless they also hold `feedback.manage`), `feedback.manage` (HR: everyone's entries, void an entry; HR administrator and the administrators). The employee needs no permission to read or reply to entries about themselves. **The auditor is not given feedback by default** (question 5).
- **Tests (integration, written first):** a manager can give feedback only about their own direct reports; HR about anyone; nobody about themselves; the employee sees only their own entries and can reply once, to their own entries only; another employee's entry is "not found"; another company cannot see or touch an entry; a voided entry needs a reason and stays on record; the appraisal panel shows only entries dated inside the period and for that employee, and changes no score; the audit log records ids and field names, never the text; roles without the permission are refused on every page and action.
- **Personal-data rules to confirm in the build:** entries are included in the employee's **data export** (the "My data" page and data-subject requests) and fall under the company's **employee retention** setting, and an erasure removes the text while the audit log (ids only) is untouched. I will check how those routines work today and extend them in this step if feedback would otherwise be missed.
- **Documents:** release notes, the data dictionary (regenerated), an explain-back note for the visibility rules.

## 5. What is not in this step

Peer and client feedback, 360-degree reviews, anonymous feedback, **requests for feedback** (an employee asking their manager), notifications by email or SMS, tags linking an entry to a KPI or a criterion, any score or analytics built from feedback, and the probation review (the next step).

## 6. Questions for the founder (my recommendation in bold)

1. **Should an employee always see feedback recorded about them?** **Yes: no private notes about a person's performance.** The alternative (private manager notes) is easier for managers but unfair to the employee and risky for the company if used later.
2. **Who may give it in this step?** **The reporting manager and HR only.** Peers, clients and anyone-to-anyone are more work to keep fair and are better added once you have seen how this is used.
3. **Kinds:** **Recognition and Coaching only**, kept separate from a formal commendation (which stays a disciplinary-area record with approval). Is that right?
4. **How far up does a manager see?** **Direct reports only** (the person's own reporting manager). A chain of command (a manager's manager) can be added if you want it.
5. **Should the auditor read feedback?** **No, not by default** (personal, and not needed for an audit of pay or compliance); it can be granted later.
6. **Correction:** **no editing; HR voids an entry with a reason and it stays on record.** Should the author be allowed to void their own entry within, say, 24 hours? **I suggest no: keep one simple route.**
7. **Appraisal:** feedback shown to the reviewer as **read-only evidence for the period, never changing a score** (as above)?
8. **Which roles may give feedback** (they need a login and a reporting-manager link): **supervisors and operations managers, plus HR**. Are there other roles in your clients' companies that manage people?

## 7. Suggested order of work once you say "go"

One pull request with one small migration: (1) the pure rules and their unit tests, (2) the schema and migration, (3) the service and integration tests, (4) the three screens and the appraisal panel, (5) the data-export and retention check, (6) docs, the explain-back note and the full suite, (7) browser checks with a manager, HR, the employee and an unrelated employee, and a report.
