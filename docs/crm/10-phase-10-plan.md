# CRM Phase 10 plan: Sales Manager, Account Manager and teams

**Status: BUILT on branch `feature/crm-phase-10` (2026-11-02) after the founder's answers: three new roles, teams set up by the administrator only, reps see only their own records, an account manager is a rep who works the accounts they own, and agreement that the new role values cannot be undone by `down.sql`. Deviations from this plan are listed at the end.** Written 2026-11-02, after the founder's answer "add both roles and a team" to the Phase 9 plan's role question. It changes who can see and change sales records everywhere, adds a database enum value and two tables, and touches access control, so under `CLAUDE.md` it needs your "go", tests first, and an explain-back note.

## 1. What I understood you want

The pack's role table for Phase 9, which the app does not have: a **Sales manager** (everything for **their team**; approves below-margin quotes), an **Account manager** (own accounts, cases, renewals), and a **team** (a rep reads accounts they own **or are on the team of**). You said yes to both roles and to a team.

## 2. What exists today (checked in the code)

- **Roles are a database enum** (`enum Role`: 12 values) and a table in `src/lib/auth/permissions.ts`. The sales module uses seven permissions (`sales.view`, `.view.all`, `.manage`, `.configure`, `.case.manage`, `.handover.accept`, `.privacy.manage`).
- **Visibility is two functions**, `seesAll(ctx)` (the `sales.view.all` permission) and `ownerFilter(ctx)` (a salesperson gets `ownerUserId = me`, anyone with view-all gets everything). They are used in **about 57 places** across the sales services, so changing them changes every list, board, report, export, case, handover and job at once. **They are synchronous**; a team needs a database read.
- **There is no team and no manager.** The only person who can both change records and see everyone's is the company administrator.
- **A normal company cannot have a salesperson at all.** `createUser` refuses the business development role unless the organization is a payroll bureau (`src/server/services/users.ts:71`), because that role was made for ThreeRoots' own sales people (it also carries the bureau pipeline permissions and sends the person to `/crm` on sign-in). So today a company that switches the CRM on can use it only through the administrator (everything), Operations (read, cases, handovers) and Finance (read).
- **Designations stay as they are:** who may approve a below-margin quote and who may accept a handover are lists of named people under Sales Settings, not roles. A Sales Manager can be put on the approvers list.
- **The round-robin pool** for new leads is "everyone whose role can manage sales but not see all" (`assignment.ts:16`).
- **Tests that pin roles:** the Phase 9b role matrix and `tests/unit/crm.test.ts` pin each role's permissions, so adding roles means changing those on purpose.

## 3. What I propose

**Three new roles, not two.** Because of the bureau-only rule above, a company needs a plain salesperson as well, so I propose `SALES_REP` (sales permissions only, no bureau pipeline, signs in to `/sales`), `SALES_MANAGER` and `ACCOUNT_MANAGER`. The alternative, lifting the bureau-only rule on `BUSINESS_DEV`, would give company staff the bureau's payroll-services pipeline permissions, so I recommend against it.

| Role | Permissions (sales) | Sees | Changes |
|---|---|---|---|
| `SALES_REP` | view, manage, case.manage | own records | own records |
| `ACCOUNT_MANAGER` | view, manage, case.manage | own accounts and the contacts, deals, cases and renewals on them, and own records | the same |
| `SALES_MANAGER` | view, manage, case.manage | **own records and those owned by everyone in the teams they manage** | the same |
| `BUSINESS_DEV` | unchanged (bureau) | unchanged | unchanged |
| administrator, Operations, Finance | unchanged | unchanged (everyone's) | unchanged |

**Teams.** Two small tables: `CrmTeam` (organization, name, manager, active) and `CrmTeamMember` (team, user). **A person is in at most one team** (a database rule); a manager may manage several teams. Teams are set up by the company administrator on a new page under Sales Settings; a manager cannot change membership (see question 4).

**Visibility becomes one function:** `scopeOf(ctx)` resolves, once per call, to "everything" or to a list of user ids (me, or me and my teams' members), and `ownerFilter` returns `{ ownerUserId: { in: [...] } }` for a list. The call sites change from a synchronous filter to an awaited one, mechanically, with the existing visibility tests as the safety net. **Everything built on it follows without more changes:** boards, reports (a manager's dashboards count their team), exports, imports, cases, handovers, assignment.

**Other behaviour:** a manager may reassign records **within their teams** (the administrator anywhere); the round-robin pool can be limited to a team; a rep still cannot read a colleague's account (question 3); the **marketing, consent, privacy, designation and configuration rules do not change**.

**Database:** `ALTER TYPE "Role" ADD VALUE` three times, and the two tables. **PostgreSQL cannot drop an enum value**, so `down.sql` can drop the tables and refuse (with a clear message) while any user holds a new role, but it cannot remove the values themselves. This is the one part that is not fully reversible, which needs your explicit agreement under rule 7.

## 4. Order of work (each step stops for your "go")

1. **Tests first:** the role matrix extended to the new roles (pinned permissions, 27 operations each); team visibility tests (a manager sees a team's records and nobody else's; a person moved out of a team stops being visible; two teams; a manager of no one sees only their own; another organization sees nothing; reassigning inside and outside a team; reports, exports, boards and cases scoped the same way).
2. **Schema and migration** (needs your "go", as above), round-tripped as far as it can be.
3. **`scopeOf` and the call sites**, with the old tests unchanged and green.
4. **Roles, permissions and the user screens** (create a user with the new roles; sign-in goes to `/sales`; two-factor policy stays a setting).
5. **Teams page and reassignment rules; assignment pool by team.**
6. Release notes, data dictionary, full suite; then stop.

## 5. What I will not do

Change payroll or statutory settings, the bureau's own pipeline, the privacy powers (the administrator only), or what Operations and Finance see (unless you say so, question 5).

## 6. Questions for you

1. **Three roles (add `SALES_REP`), or lift the bureau-only rule on `BUSINESS_DEV`?** I recommend the third role.
2. **What is an Account Manager, exactly?** In the pack, "own accounts, cases, renewals". I have made it a rep who works the accounts they own. Should an account's owner be able to differ from the owner of the deals on it (so one person looks after the client while others sell)? That would need a second owner field on accounts (`accountManager`), a larger change.
3. **May a rep read, but not change, accounts owned by people on their team?** The pack says so. I have not done it by default because it adds a second, read-only scope.
4. **Who sets up teams:** the administrator only (my default), or may a Sales Manager add and remove members of their own teams?
5. **Should Operations and Finance keep seeing everything** (today's behaviour), or only won deals, accounts and handovers? (Asked in Phase 9, still open.)
6. **Agree that the new enum values cannot be undone** by `down.sql`?
7. **Order against the module work.** You asked for the CRM first. This is the next CRM phase; the pending review findings F-03 to F-05 change permissions too and are best decided before it.

When you answer 1 to 6 and say "go", I start with step 1, the tests.

## What was built, and where it differs from the plan above

- **Visibility is not a new asynchronous function at 57 call sites.** The shared `ownerFilter` stays synchronous (so no call site changed); `requireSales`, which every service function already calls first, now works out whose records the person may see (a sales manager's own and their open teams' members) and remembers it for that call. Until it has been worked out the narrowest answer, only themselves, is used, so a missed call can only show too little, never too much. The sites that decided "own or everything" by hand were changed to use it: tasks, voiding an activity, the duplicate check, the import's duplicate check, the activity report and the owner choices.
- **A sales manager's reach** is themselves and the members of the open teams they manage; changes to a team are felt at the next call. A team manager must hold the Sales Manager role.
- **A sales manager may be named a quote approver** (a role that manages teams counts as a sales manager) and approves quotes within their reach. **Merging records stays with the administrator** (it needs to see everything). **Escalations** (a case breach, a rule that tells "the sales managers") still go to the roles that see everything, not to team managers.
- **Round robin by team: done afterwards** (branch `feature/crm-roundrobin-by-team`, migration `20261115090000_sales_team_round_robin`): a sales manager's new leads with no owner are shared out among the members of their own team, each team on its own rotation. **Not done:** an account has no separate account-manager owner (you chose the simple definition).
- **Sign-in** takes the three new roles to My Tasks. **Teams page** (Sales > Teams, administrator only). The bureau's `BUSINESS_DEV` role is unchanged and still bureau-only.
- **Migration** `20261114090000_sales_teams_roles`: three role values and two tables. `down.sql` drops the tables and **refuses while any user holds a new role**; the three unused values stay (tested).
