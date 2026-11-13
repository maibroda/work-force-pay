# Explain-back note: governance step 2b, the second-person rules

For the founder. Plain language, payroll vocabulary. Plan: `hr-governance-step2-plan.md` (#188), part 2b. **This changes who may sign off sensitive decisions (approvals and access control) and adds a migration: please read it.** Built on your "go"; **you did not answer the plan's ten questions, so I used my recommended answers (listed at the end)**.

## The rule, in one line

**The person who did the work does not also sign it off.** Three places, each enforced on the server:

1. **Closing a case.** The person who **resolved** a case does not **close** it. This applies to **every kind of case** (welfare, grievance, harassment, misconduct, and the rest), because the case file already described the close as "a second pair of eyes" and nothing enforced it.
2. **Approving a sanction.** The person who **raised** a sanction (query, warning, suspension, termination recommendation) does not **approve** it. This fixes a gap: until now a Company Administrator could raise and approve their own sanction alone. **A commendation (praise) is unchanged.**
3. **A new succession nomination.** A nominator **proposes** a successor; a **different** holder of the succession function **approves** it. A proposed successor **does not count** as cover until approved. Changing how ready an already-approved successor is stays immediate; removing one stays immediate. Every successor who existed before this change stays approved.

## The exception for small companies

If the person is **the only holder of the right needed** (nobody else could sign off), they may sign off their own work **with a written reason of at least 20 characters**, and the record is **flagged "single holder"** with the reason kept. **It is never available while someone else could do it**, however good the reason. "Another holder" means another **active** user of **this company** whose role holds the right, or a Delegated HR Officer with a **live** grant of the function; a user switched off, an outsourced officer past their end date, a revoked grant, or another company's people do not count. The rights needed are: close a case: `hr.approve` (or the welfare function for a welfare case); approve a sanction: `hr.approve` **and** `discipline.manage`; approve a nomination: the succession function.

## What the code does, step by step

1. A case now records **who resolved it**; a sanction records **who raised it** and **who approved it**; a nomination records **who proposed it** and **who decided it**. Re-opening a case clears who resolved it.
2. When someone closes, approves or approves-a-nomination, the system checks whether they are the same person who did the work. If not, it goes ahead. If so, it counts the **other holders**: one or more means **refused** ("You resolved this case, so a different person closes it"); none means it asks for the reason and flags the record.
3. **A record from before this change has no recorded resolver or raiser, so the rule does not apply to it** (it cannot be known). Stated plainly: those records can still be signed off by the same person.
4. The screens follow the server: the Close, Approve and nomination buttons show "a different person does this" for the person who did the work, and ask for the reason only for the only holder.
5. **Audit** carries ids, the step and the flag, **never the reason**. **Personal data:** the reasons are in the employee's copy of their data (for cases and sanctions, as for the other notes) and are **removed on erasure**; the shape stays.

## A worked example

Tunde's Security Co. has two HR administrators, Obi and Zainab, and a Company Administrator, Adaeze. Obi resolves a grievance and raises a written warning. **Obi cannot close the grievance or approve the warning**: Zainab (or Adaeze) does. Obi nominates Gbenga as successor to the supervisor role: it shows "awaiting approval" and the role still reads "No one ready now" until **Zainab approves**. Months later Zainab leaves and Obi is the only HR administrator (Adaeze holds no succession right). Obi adds another successor: the form now asks "why are you adding one without a second person?"; with a reason of at least 20 characters it is added, **flagged**, and counts at once.

## What could go wrong, and which test proves it does not

| Risk | Test (`tests/integration/second-person.test.ts`, `tests/unit/second-person.test.ts`) |
| --- | --- |
| The same person still signs off their own work | the three refusals: resolver cannot close (welfare included, and an officer in the welfare lane), raiser cannot approve, proposer cannot approve; a reason does not help while another holder exists |
| A small company is stuck | the single-holder tests: allowed with a 20-character reason, refused without, flagged |
| Someone who should not count is counted | the active, outsourced-expired and other-company cases |
| A proposed successor counts as cover | "is proposed, does not count": cover stays "No one ready now" until approved |
| Existing successors stop counting | the default test: a row from before the change is approved |
| The reason leaks | the audit tests: by ids and the flag, never the reason; the erasure test |
| Praise is blocked | the commendation test |
| Another company acts | the tenant-isolation test |

## Existing tests I changed (the only ones), and why

Eleven existing tests had the **same person** do both steps, which the founder's rule now forbids. I changed **only who does the second step** (or, for the succession tests, gave the written reason a lone holder now needs); **every original assertion is kept**: `hr-officers.test.ts` (the officer resolves a welfare case; the HR administrator closes it, and I added that the officer is refused), `hr-records.test.ts` and `letters.test.ts` (a second person approves the sanction), `succession.test.ts` (nominations by the only holder in a test company give the reason) and my own `record-read-log.test.ts`. In `hr-records.test.ts` the assertion that the approver is the raiser (`approvedBy` equals the raiser's name) became "equals the second person's name", which is the rule itself.

## Assumptions (my recommended answers to the plan's questions)

4. Welfare closure needs a second holder, with the single-holder exception. 5. **The same rule for every kind of case.** 6. **A sanction's approver must differ from its raiser** (a behaviour change that fixes a gap). 7. **Only a new nomination needs a second person;** readiness changes and removals stay immediate (logged). 8. Existing successors count as approved. 9. The single-holder exception only when no other active holder exists, with a 20-character reason, flagged.

## What I did not do or test

- **Not covered:** a commendation (unchanged); changing readiness or removing a successor (immediate, logged as before); the second-person rule for exits, probation (already built) and other approvals.
- **A company with exactly one HR person and a Company Administrator** has two holders of `hr.approve` (so a case is closed by the administrator, not the HR person) but only **one** holder of the welfare and succession functions (so those use the written reason). That is the design; say if you would rather the Company Administrator could close a welfare case.
- **Checked in a browser:** see the release notes entry and the report; anything not listed there was not checked on screen.
