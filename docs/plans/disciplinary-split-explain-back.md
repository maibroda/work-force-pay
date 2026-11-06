# Explain-back note: Disciplinary separated from Employee relations

Branch `disciplinary-split`. **No migration and no change to pay.** This changes **who may see and handle** misconduct cases and sanctions, so it is an access-control change and needs your review. Built on your decision of 2026-11-05 (`docs/plans/founder-decisions-2026-11-05.md`, section 4, item 1).

## The rule, in plain words

Misconduct cases and sanctions now need **two** permissions, not one:

- to **see** them: the HR permission you already needed (`hr.view`) **and** the new `discipline.view`;
- to **work** them (open, note, assign, move, resolve, issue a sanction): `hr.manage` **and** `discipline.manage`;
- to **sign off** a sanction, or close or re-open a misconduct case: `hr.approve` **and** `discipline.manage` (the maker-and-checker rule is unchanged).

Because both are needed, **the change can only take access away, never give more**. A commendation is praise, not discipline, and still needs only HR access.

## Who has the new permissions today

| Role | See (`discipline.view`) | Work (`discipline.manage`) |
| --- | --- | --- |
| HR administrator, company administrator, super administrator | yes | yes |
| Auditor | yes (audit needs the whole file) | no |
| Finance | **no** (it could read misconduct before; that is the one change in who sees what; **accepted by the founder, 2026-11-06**) | no |
| Operations, payroll, supervisor, employee, client and sales roles | no | no |

## What a person without `discipline.view` sees

- Misconduct cases are **missing from the lists and the counts**, and a misconduct case opened by its address says **"Case not found"**: it does not confirm the case exists.
- Sanctions are **left off the employee's file and timeline**; commendations stay.
- The HR digest **preview** leaves out misconduct deadlines and pending sanctions. (The emailed digest goes to HR administrators, who have the permission; see the questions below.)

## A worked example

An HR administrator opens a misconduct case about a guard: "left the post". Finance opens HR > Employee relations: the case is not listed and the "open cases" figure does not count it; if Finance types the case's address it says "Case not found". The auditor opens HR > Disciplinary: the case is there, read-only. The company administrator, who did not open it, signs off the written warning raised from it; the HR administrator who raised it cannot sign it off.

## What could go wrong, and what proves it does not

| Risk | Test |
| --- | --- |
| Someone without disciplinary access still sees or counts misconduct | `discipline-split.test.ts`: "does not see misconduct cases in any list, and cannot open one by its id", "is not counted in the headline numbers", the employee timeline, the overview and the digest preview |
| A person who handles grievances can still work misconduct | "an HR administrator without the disciplinary permission": every step (open, note, assign, move, resolve, close, re-open, issue a sanction) is refused, while grievances and counselling work as before |
| Sanctions are raised or signed off without the permission | "sanctions in the disciplinary register": raise, approve and reject are refused; a commendation is not |
| The change gives someone more access | `discipline-permissions.test.ts`: nobody holds a disciplinary permission without the matching HR one; the roles are exactly the list above |
| Another company sees a case | "another company's misconduct case is not found", and the sanctions list is scoped to the company |

## What I did not do or test

- **No separate role was added (the founder's answer, 2026-11-06: no).** The roles are fixed in code, so the HR administrator holds both permissions. The permissions and every check are in place and tested (the tests take one permission away from the HR administrator and watch the checks hold), so a separate role can be added later without changing the checks.
- The emailed HR digest is not filtered by reader: it goes to the HR administrators and the extra addresses the company configures, and still lists misconduct deadlines and pending sanctions. If extra addresses are not HR staff, say so and I will leave the disciplinary lines out of what they receive.
- **Other places that mention disciplinary records, not changed:** the employee's own data-access export, retention rules, letters and the breach register. They are not a role-based view of the case list.
- The pages were checked in a browser against the test database for the HR administrator, finance and auditor roles only where noted in the report.
