# HR governance, step 1: the Delegated HR Officer

Written 2026-11-11. **A proposal only: nothing is built and no migration is written until the founder answers the questions in section 6 and says "go".** This is step 1 of `docs/plans/hr-governance-plan.md`, on the founder's decisions of 2026-11-10 (`founder-decisions-2026-11-10-hr.md`): a company with no HR administrator must still be able to handle welfare cases, run surveys and keep succession, without the Company Administrator gaining access to what is deliberately kept from them. **It changes access control, so it is a critical module** and needs your "go" and the full test-first process. Read-logging, the second-person rules and the retention policy are steps 2 and 3.

## 1. What exists today (checked in the code on 2026-11-11)

- **A person has one role** (`User.role`). What a role may do is a fixed table (`ROLE_PERMISSIONS`); `can(role, permission)` reads it. The four functions in question, `welfare.manage`, `succession.manage`, `survey.manage` and `survey.assist`, are held by `HR_ADMIN` only and withheld from the company and super administrators **on purpose**.
- **Where they are checked:** the page and action guards (`requirePage`, `requireAction`) and `assertCan` in the services, plus about thirteen direct `can(ctx.role, ...)` checks for these four permissions (the welfare case hiding in `relations.ts` and the HR timeline, and the survey pages), and the menu (`visibleSections`).
- **No per-person permissions exist.** The login session carries the role only.
- **A company with no `HR_ADMIN` has nobody** who can read a welfare case, run a survey or keep a succession list.
- **Users** are created in Settings > Users with a role; an employee login is linked to an employee record, but a login need not be (an external consultant has none).
- **Two-factor sign-in** exists (TOTP) but is not enforced by role, except for the client portal roles.

## 2. What step 1 adds

1. **A new role, `HR_OFFICER` (Delegated HR Officer).** On its own it can do **almost nothing**: the same as an ordinary signed-in user (see their own details), and **nothing in HR**. It gains abilities only through function grants.
2. **Function grants, from a fixed list of four:** **Welfare cases** (`welfare.manage`), **Surveys** (`survey.manage`), **Assisted survey sessions** (`survey.assist`) and **Succession** (`succession.manage`). The list is fixed in code: a company cannot invent a function, so the audit story always covers it. A grant records who gave it, when, **why** (a short reason), an optional **end date**, and who revoked it and when.
3. **Who appoints.** **Only the Company Administrator** creates an officer (or changes an existing user's role to Delegated HR Officer) and grants or revokes functions, under **Settings > HR officers**. **The Company Administrator can never grant a function to themselves**, and the grant to an officer **does not give the administrator that function**: welfare records stay invisible to them. Every appointment, grant and revocation is audited by ids and the function name.
4. **Grants take effect and end at once.** The grants are read on every request, so a revoked or expired grant stops working immediately, even in a session already open.
5. **An outsourced HR administrator** is a Delegated HR Officer (or an `HR_ADMIN`) **flagged "external"** with a **required end date**. They need no employee record. Reads of sensitive records by an external user are logged in step 2; in step 1 the flag, the end date and the refusal to sign in after it are built.
6. **The notice.** For the Company Administrator, a banner on the HR pages and the dashboard says which of the four functions **no one currently holds** (no `HR_ADMIN`, no officer with a live grant), and links to Settings > HR officers: "Welfare cases, surveys and succession need an authorised HR officer." **Succession is simply unavailable (not even visible in the menu) until someone holds it.**
7. **Welfare needs no wider access.** A **welfare officer** gets a dedicated **Welfare cases** view (list, open, work, resolve welfare cases only; the existing case rules apply: always confidential, the employee reads their own case), so they do **not** need `hr.view`, which would show every other HR record. The existing HR cases page stays as it is for `HR_ADMIN`.
8. **Two-factor sign-in is required** for the Delegated HR Officer role and for any external user (question 5).

## 3. The rules in plain terms (with a worked example)

- **No inheritance, no escalation.** A grant adds **only** the permission(s) of its function, never anything else; a Delegated HR Officer with no grant cannot open an HR page; the Company Administrator granting a function does not hold it; an officer cannot grant functions to anyone.
- **The Company Administrator cannot read what they appoint someone to read.** That is the point of the design: welfare, succession and survey results stay with the holder.
- **Worked example:** Tunde's Security Co. has no HR administrator. The Company Administrator, Adaeze, opens Settings > HR officers, appoints Ngozi (an HR consultant, **external, until 31 March**, no employee record) as a Delegated HR Officer, and grants **Welfare cases** (reason: "outsourced HR support") and **Surveys**. Ngozi signs in with two-factor, sees the **Welfare cases** and **Surveys** menu entries and nothing else of HR; an employee raises a bereavement support request, which Ngozi can read and Adaeze cannot. The notice to Adaeze still says "Succession needs an authorised HR officer", because nobody holds it. On 1 April Ngozi's access ends: her session is refused and her grants no longer count.

## 4. Files, migration and tests (once approved)

- **Migration (additive, reversible, round-tripped on a copy of the seeded database):** one **enum value** (`HR_OFFICER`, which Postgres cannot drop, so the down script recreates the role enum and **converts any Delegated HR Officer to an ordinary employee login and deletes their grants**, as the welfare migration did for its case type), one enum for the four functions, one table (`UserFunctionGrant`), and two columns on `User` (`external`, `accessEndsOn`).
- **Code:** the function table and `canCtx(ctx, permission)` (role table plus live grants, only for the four assignable permissions) in `src/lib/auth/`; the session loads live grants into the request context; the two guards and `assertCan` use it; the **thirteen direct checks** and the menu use it; Settings > **HR officers**; **Welfare cases** view; the banner; sign-in refuses an expired external user; the data dictionary, release notes, and an explain-back note.
- **Tests first:** an officer with no grant is refused every HR page and action; each function opens exactly its own pages and actions and nothing else (a matrix of all four functions by all pages); a grant does not give the Company Administrator the function, and the administrator cannot grant to themselves; only the Company Administrator can grant or revoke; revoking or expiring stops access on the very next request; an external user is refused after their end date and cannot be created without one; the welfare officer reads welfare cases without `hr.view` and still cannot read any other HR record or case type; the notice lists exactly the functions nobody holds; succession is hidden from the menu until held; **every existing role-by-permission test still passes unchanged** (the new role is added to the role lists); audit by ids and function names only; tenant isolation.

## 5. Not in step 1

Read-logging of sensitive records, the second-person rules for welfare closure and succession nominations, the retention policy and legal holds (steps 2 and 3); a free-form permission editor; officers for any function outside the four; officers granting functions; and any change to what `HR_ADMIN`, the administrators, the auditor or finance can do today.

## 6. Questions for the founder (my recommended answer first)

1. **Is the Delegated HR Officer a role that can do nothing until given functions from a fixed list of four** (welfare cases, surveys, assisted sessions, succession)? **Recommended: yes.**
2. **Does only the Company Administrator appoint and grant**, never granting to themselves, with the HR administrator unable to grant? **Recommended: yes.**
3. **May an officer be external** (an outsourced consultant), with a **required end date** and no employee record? **Recommended: yes.**
4. **Is a reason required for every grant**, and an optional end date for internal officers? **Recommended: yes.**
5. **Is two-factor sign-in required for the officer role and any external user?** **Recommended: yes**: they handle the most sensitive records, and your standing rule requires it for administrator roles.
6. **Should the welfare officer get a dedicated Welfare cases view** and no wider HR access? **Recommended: yes**, so welfare does not require `hr.view`.
7. **Should the notice appear for the Company Administrator** (and not for others), naming the functions nobody holds? **Recommended: yes.**
8. **What if the last holder is removed while a welfare case is open?** **Recommended: the case stays confidential and unreadable until someone holds the function again**; the notice says so. The employee who raised it still reads their own.
9. **Is step 1 first?** **Recommended: yes**, then read-logging and the second-person rules, then retention after the lawyer.

**Risks:** more roles mean more ways to mis-assign access: the safeguards are the fixed function list, no inheritance, audited grants with a reason, immediate revocation, and tests of the whole function-by-page matrix. A lawyer should review the external-officer arrangement (a data processor agreement) and the wording shown to the Company Administrator.
