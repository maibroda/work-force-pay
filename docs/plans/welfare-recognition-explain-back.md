# Explain-back note: welfare support and recognition awards (step 1)

Branch `welfare-recognition`. One migration, `20261203090000_welfare_and_recognition` (additive: two enums, two tables, one new case type with a nullable kind, one policy column). This touches **access control** (who may read a welfare case) and **personal data** (the words of a citation and a case), so please read it. Built on your "go" of 2026-11-10 to the plan `docs/plans/welfare-recognition-plan.md` (#171). **You did not answer the plan's ten questions, so I used my recommended answers; they are listed under "Assumptions" below.** **No money is involved**: pay, payslips, payment files and statutory figures are not touched.

## The rules, step by step

1. **Welfare support is a kind of case** (the existing case system), always confidential. An employee raises it from **My cases and support** and must choose a kind (bereavement, hardship, health, family or housing, other). HR with the new `welfare.manage` permission can also open one on someone's behalf.
2. **Who can read a welfare case: only the HR administrator** (the sole holder of `welfare.manage`, by your decision: the company and super administrators are refused too). For everyone else (the administrators, the auditor, finance, anyone else who reads HR records, other employees, other companies) the case is **"not found"**, not "forbidden". The same rule is applied in every place a case can surface: the case list and its filters, the single case, the employee's HR timeline and the HR digest. The employee who raised it always reads their own.
3. **Misconduct handling is unchanged**: a welfare case is hidden by the same mechanism that hides misconduct cases from people without the disciplinary permission, extended by one more type.
4. **The welfare summary** counts requests opened in a year, by kind, **never with a name**. Any group of **fewer than five** is shown as "fewer than 5" (zero stays zero), so a single person cannot be picked out. Only `welfare.manage` can open it.
5. **Award types** (HR with `hr.configure`): a name (no duplicate however typed), an optional long-service year, and whether the award may be shown on the board. An award type is switched off, never deleted; awards already made stay.
6. **Nominating**: a manager nominates only **their own direct reports**, HR anyone, **nobody themselves**; it needs a citation of at least ten characters; an inactive award, an inactive employee, or a second open nomination for the same person and award is refused. A person who may not nominate that employee is told only "Employee not found".
7. **Deciding** (`hr.approve`): **someone other than the nominator** approves or declines; a decline needs a reason (at least five characters). A decided nomination cannot be decided again. A nominator may **withdraw** while it is undecided; HR may withdraw an approved award; both with a reason. Nothing is deleted.
8. **What the employee sees: only an approved award.** A nomination under consideration, a declined one and a withdrawn one are never shown to the person.
9. **The board**: an approved award appears only if its type may be announced **and the recipient agreed** (they can change their mind at any time), and only for someone still employed.
10. **Milestones are a prompt**: staff reaching a long-service year (the company's list, default 5, 10, 15, 20) within 60 days, with whether an award is already nominated. **Nothing is created automatically.**
11. **Personal data and audit.** The citation and the reasons are in the **copy of their data** a person can ask for (approved awards only); on **erasure** the citation, decline reason and withdrawal reason are removed and the shape stays. **Audit entries carry ids and field names only**, never a citation, a reason or a case's words.

## A worked example

An employee, EMP-000025, raises a welfare case, kind **Bereavement**, with a description. The HR administrator opens **Employee relations cases** and reads it; the company administrator, the auditor and the finance officer open the same case link and get "Case not found", and it appears in none of their lists. The HR digest that morning mentions **no** welfare case. At year end, **Welfare summary** shows Bereavement as "fewer than 5" because only two people asked; the total is also "fewer than 5". Separately, a supervisor nominates a direct report for **Employee of the quarter** with two sentences of reason. The HR administrator approves it. The employee now sees it under **My recognition**, with the choice to be shown on the board; they agree, and every colleague sees it on **Recognition board**. Had HR declined it, the employee would never have known.

## What could go wrong, and what proves it does not

| Risk | Test |
| --- | --- |
| A welfare case is read by someone without `welfare.manage` | `welfare.test.ts`: the company and super administrators, the auditor, finance, another employee and another company are each refused or "not found" on the list, the single case and every action; the owner reads their own |
| A welfare case leaks through a side door (timeline, digest) | `welfare.test.ts`: the timeline and the HR digest for roles without the right never mention it |
| A small group identifies a person | unit `hideSmallGroups` (zero stays zero, 1 to 4 hidden, 5 shown) and the summary test |
| A manager nominates someone who is not their report, or HR nominates themselves | `recognition.test.ts`: refused with "not found" / refusal as designed |
| The nominator decides their own nomination | `recognition.test.ts`: refused |
| The employee learns of an undecided, declined or withdrawn nomination | `recognition.test.ts`: `myRecognition` returns approved awards only |
| The board shows someone who did not agree, or someone who has left | `recognition.test.ts`: only agreed, announce-able, current staff appear |
| A citation or reason leaks to the audit log, survives erasure, or is missing from the data copy | privacy tests: secret phrases absent from audit; the data copy includes the person's approved awards; erasure removes the words and keeps the shape |
| The migration loses data | round trip (up, down, up) on a copy of the seeded database; the down script turns welfare cases into confidential "Other" cases rather than dropping them |

## Assumptions (my recommended answers to the plan's questions; change any of them)

See the plan for the ten questions. In short: welfare cases are readable only by `welfare.manage` (the HR administrator alone, your decision of 2026-11-10); the summary hides groups under five; award decisions need a person other than the nominator; the employee hears only of approved awards; the board is opt-in by the recipient; milestone years are a company setting (5, 10, 15, 20); **no money, gifts or budgets**; no notifications; engagement surveys are a later step.

Smaller choices you did not ask for: **the old page "My grievances" is renamed "My cases and support"** (same address); the welfare kind is required when the type is Welfare; an award type's long-service year is optional.

## What I did not do or test

- The wording shown to employees about welfare support and the retention of welfare cases are **for a lawyer to review**.
- **Not built:** engagement surveys, gifts or money for an award, public sharing, notifications, welfare follow-up scheduling, a separate welfare officer role.
- Browser checks are reported in the task report (what was seen on screen and what was not).

## Decided: HR administrator only

You decided on 2026-11-10 that welfare cases are read by **the HR administrator only**. `welfare.manage` is therefore withheld from the company administrator and the super administrator (who otherwise hold every permission), the same way `subscription.manage` is withheld. The test `tests/unit/welfare-recognition.test.ts` fails if any other role is ever given it, and `welfare.test.ts` checks that both administrators, the auditor, finance, other employees and other companies get "not found".

**Consequence to know about:** a company that has **no HR administrator** has nobody who can read or work a welfare case (the employee who raised it still reads their own). A company should keep at least one HR administrator.
