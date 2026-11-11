# HR governance step 1: the Delegated HR Officer. Explain-back note

For the founder. Plain language, payroll vocabulary. Plan: `hr-governance-step1-plan.md` (#184). This is access control, so CLAUDE.md asks for this note.

## What the code does, step by step

1. **A new role, HR officer, starts with nothing.** Its permission list is only "see my own details" and "set up my own security". It cannot open any HR page. Think of a new clerk given a badge that opens no door.
2. **Only the Company Administrator (and our platform staff) hands out keys.** One new permission, "manage HR officers", is given to those two roles. It is **not** given to the HR administrator, so the person who would benefit cannot give a key to themselves or to a friend. An administrator also cannot be turned into an officer, and nobody can appoint themselves.
3. **A key is a grant of one of four fixed functions**: welfare cases, surveys, assisted survey sessions, succession. Each opens exactly one permission that already existed. The list is fixed in code, so a company cannot invent a function the audit story does not cover. A grant carries a reason (kept in Settings, never in the audit log), an optional end date, and who granted it and when.
4. **Keys are checked on every request, not stored in the sign-in token.** On each request the system reads the officer's live grants from the database (not revoked, end date not passed). So when the Company Administrator revokes a key, it stops working on the officer's very next click. One rule decides it, `canCtx`: the role table first; then, only for an HR officer and only for the four permissions, the live grants.
5. **Outsourced officers** need an end date (the last day they can sign in; that day still works). After it, sign-in is refused (it looks the same as a switched-off account, so nothing is revealed) and an open session stops working. They need no employee record. They must use two-factor sign-in with no grace period.
6. **Welfare lane.** The existing welfare cases were reachable only through pages that also need general HR rights. An officer has none. So a "lane" lets someone holding the welfare function read and work **welfare cases and nothing else**; any other case, even by its address, is "Case not found".
7. **Ending an appointment** revokes every grant, switches the account off and bumps the session counter so open sessions end.
8. **A notice** tells the Company Administrator when a function has nobody holding it (no HR administrator and no officer with a live grant), because then that function's records cannot be read by anyone.

## Where each rule comes from

The founder's register of 2026-11-10 (Delegated HR Officer, outsourced HR, role separation), the plan's nine questions answered on my recommended defaults (below). Nothing here is a payroll or statutory rule.

## Worked example

Ada is the Company Administrator; Ngozi is an outsourced HR consultant. Ada creates Ngozi as a user, appoints her as an **outsourced** officer ending 31 March, and grants **Welfare cases** "for the Q1 backlog". Ngozi signs in with her authenticator code, sees HR > Employee relations > **Welfare cases** and the welfare cases only (a grievance by id is "not found"; she has no Surveys, no Succession, no employee list). On 10 February Ada revokes the grant; Ngozi's next click on a welfare case is refused. On 1 April she cannot sign in at all. The audit log shows four entries by ids and function name: appointed, granted, revoked, never the reason. Meanwhile the HR administrator, Obi, tries to grant himself Surveys: refused, he does not hold the permission.

## What could go wrong

- **An officer who can both resolve and close a welfare case.** The "another person must close it" rule is governance step 2, not built. Stated plainly.
- **Read-logging** of welfare and succession reads is step 2, so a read by an officer is not yet separately recorded.
- **Two-factor for officers changes the sign-in gate** (a STOP item in CLAUDE.md). It is one extra role in the same always-on rule the client portal already uses; flagged for your review.
- **Removing an officer on rollback:** Postgres cannot drop an enum value, so the down script rebuilds the role type. Any officer is first made an inactive ordinary login, so no one keeps access by accident.
- **Outsourced HR administrator** (a full administrator with an end date) is not built; only the officer role can be outsourced.

## Which test proves it

- `tests/unit/hr-functions.test.ts`: the fixed list; the officer role's permissions are exactly two; a tampered or revoked or expired grant counts for nothing; non-officers ignore grants; every existing role's permissions are unchanged.
- `tests/integration/hr-officers.test.ts`: nothing without a grant; exactly the function granted and no more; the welfare lane (only welfare cases, "not found" for the rest); revoking is immediate; the HR administrator, auditor and employee cannot appoint, grant or list; nobody appoints or grants themselves; the outsourced officer needs an end date and a grant cannot outlive it; ending an appointment switches the account off and ends sessions; the audit log carries no reason; another company's administrator cannot touch these users; two-factor is required; sign-in is refused after the end date and works on the day itself.
- `tests/unit/navigation-*.test.ts`: the new pages appear only for the permissions they need.

## My answers to the plan's nine questions (adopted for this build)

1. The officer role does nothing until granted a function, from the fixed list of four. 2. Only the Company Administrator appoints and grants, never to themselves. 3. An outsourced officer has a required end date and no employee record. 4. A reason is required for each grant. 5. Two-factor is required for officers. 6. A dedicated Welfare cases page that does not need general HR rights. 7. A notice for the Company Administrator naming functions nobody holds. 8. If the last holder is removed, welfare cases stay unreadable until someone holds the function. 9. The same rules for company and outsourced officers apart from the end date.
