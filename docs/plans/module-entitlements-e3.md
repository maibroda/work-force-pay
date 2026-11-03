# Entitlements, step E3: enforcement (plan)

**Status: a plan only, for the founder's "go". No code, permission, migration or screen is changed by this document.** Written 2026-11-03, after E2 (subscriptions) was merged in #121. E3 touches access control, so under `CLAUDE.md` it needs your "go" and, when built, an explain-back note.

## 1. What E3 must do, in plain words

Today every company can open every page its role allows. After E3, a company that has not bought a module is **refused on the server** (a plain message, not a broken page), menus stop showing what it has not bought, and nobody can reach a module's pages, actions, API routes or scheduled jobs by typing the address. It must be impossible to ship a new page, action, route or job without saying which module it belongs to. **Nothing is switched on by this step itself**: the enforcement stays off until you turn it on, module by module.

## 2. What I found (checked in the repository, 2026-11-03)

- **91 permissions** in `src/lib/auth/permissions.ts`; every page (`requirePage`), every server action (all go through `act` in `src/app/actions/_run.ts`) and the services (`assertCan`, about 490 calls) name one. **Permissions cannot carry the module** (section 3, item 1).
- Pages that name **no** permission or decide "some other way", the 19 API routes, and the 12 scheduled jobs (`/api/cron/*`, public to the middleware, each checking its own secret) do not go through those functions and need a separate declaration.
- The company's modules are available from E2 (`modulesOn(orgId, date)`: null when a company has no subscription).
- **The only module switch today** is the sales one (`CrmSetting.enabled`, checked in `requireSales`; `salesOnly` in the menu). The CRM module's permissions (`sales.*`, `crm.*`) would also be tied to the CRM module, so a company cannot use the CRM unless it bought it.
- The decided module table (`docs/plans/module-entitlements-table.json`, 412 entries; **48 still guesses**) is the starting map.

## 3. Design I recommend

1. **Every way into the app belongs to one module, declared in one file** (`src/lib/entitlements/entry-modules.ts`): each page route, each server-action file, each API route and each scheduled job (328 entries, started from the decided table). *This replaces my first idea (a module per permission), which the repository disproved: eight permissions are shared between modules (`gl.view` is used by Accounting, Client billing and Payables pages; `client.view`, `payment.manage`, `payroll.view`, `operations.view`, `employee.view`, `employee.sensitive` and `users.manage` too), so a permission cannot say which module an action belongs to.* Services are not listed; they are reached only through these.
2. **Where each kind is checked:** pages in `requirePage`, which learns the page's route from a request header the middleware sets (a page is rendered on every visit, including soft navigations, so this cannot be skipped by clicking around; a layout cannot do it, because layouts are not re-run on soft navigations); server actions in the one wrapper they all go through (`act` in `src/app/actions/_run.ts`; each action file says which module it is in, one line per file, and a test checks the line matches the declaration); API routes and jobs in a small helper each route calls.
3. **Tests that make it impossible to forget** (the first of these are built, in `tests/unit/entitlements-entry-points.test.ts`): (a) every page, action file, API route and job has a declaration and none outlives its file; (b) only real modules, or "bureau", are used; (c) an unconfirmed entry counts as the core; (d) the places that must always work (home, subscription, security, audit log) are the core; (e) the list of shared permissions is pinned, so a new one gets looked at. Still to build with the guards: with only the core on every non-core entry is refused and every core one allowed; and a company with each of the five plans reaches exactly its modules.
4. **The company's modules are read once per request** and not kept between requests (a change by platform staff applies on the next request; no stale cache to reason about).
5. **The switch is a platform setting with three states: OFF, REPORT, ENFORCE, per module.** OFF is today's behaviour. REPORT lets everything through but writes a log line for each thing that would have been refused (module, permission, company, never personal data), so you can run for a week and see what enforcement would have blocked before it blocks anything. ENFORCE refuses. **It cannot be set to REPORT or ENFORCE while any company lacks a subscription** (your answer 2 of 2026-11-03), checked when the setting is changed, and a check script (`npm run entitlements:check`, also run in CI against the seed) fails if one does. Changing it needs `SUPER_ADMIN` and is audited.
6. **What a refused person sees:** on a page, a plain "This isn't part of your plan" page naming the module and telling them to ask whoever looks after their account (their bureau, or the platform); in an action or service, the same message as a business error. The menu hides what is not bought.
7. **Unconfirmed map entries are treated as the core** (open to everyone) until you confirm them, so enforcement can only be too loose, never lock a client out of something on a guess. The 48 guesses are listed for you, as now.
8. **A module that has ended** is refused outright in E3. Keeping its data readable for the read-only period (`readOnlyUntil`, already stored) belongs to E5 (downgrades), as the plan says.

## 4. Steps (each stops for your word)

| Step | What | Migration | Behaviour change |
|---|---|---|---|
| **E3a** | The entry-point declarations and their tests (built), then the guards (the page header, the action wrapper, the route helper) made module-aware but reading a hard-coded "everything on". | None | None: no company is refused anything |
| **E3b** | The platform setting (OFF / REPORT / ENFORCE per module, audited, refusing while a company lacks a subscription), the check script, a read-only platform page, the refusal page, menu hiding. | One small table, with `down.sql` | None until you set something to REPORT |
| **E3c** | Turn modules on one at a time, REPORT first, then ENFORCE, starting with the least risky (Analytics, Inventory, Accounting, Payables) and ending with Payroll, which I would only enforce with your explicit word. | None | Yes, per module, only when you decide |

E3a and E3b change nothing a user can see. E3c is where a mistake could lock a client out, which is why it is last, reversible by setting the module back to OFF, and starts with REPORT.

## 5. What I found that you need to decide (these change the design)

1. **The client portal and the default plan (decided on my recommendation when you said "go", 2026-11-03; please confirm).** The portal runs inside the bureau client's own organization, whose default plan (Payroll Essentials) has no Contracts and deployment, and the catalogue said the portal needed it, so enforcement would have locked every bureau client's portal. **The catalogue now says the portal needs only Payroll** (everything it does is payroll). Built and tested; the other option (widen the bureau default) is not taken.
2. **The switch:** a platform setting in the database that refuses to turn on while a company lacks a subscription (recommended, needs the small migration in E3b), or an environment variable (no migration, but nothing can refuse).
3. **REPORT mode first, then ENFORCE?** (recommended) or straight to ENFORCE per module.
4. **Ended modules refused outright in E3**, with read-only handled in E5 (recommended), or read-only built now for `.view` permissions.
5. **Who sees the refusal page's contact:** I would show "your bureau" for a bureau's client and "the platform" otherwise. Is there a support contact to show instead?

## 6. Risks I see, and things this step does NOT do

- A wrong module on a permission locks people out of what they paid for or leaves something open; the tests in section 3 and REPORT mode exist for that, and it cannot lock anyone out while the switch is OFF.
- Platform changes to a subscription still need no second person; they are audited. If you want maker-checker on subscription changes, that is a separate decision.
- Not in E3: limits (headcount, seats), the ports (E6), read-only after downgrade (E5), prices, the configurator (E4), any change to payroll, statutory or posted data.

## 7. Progress on E3a (2026-11-03)

Built, with tests first: the portal now needs Payroll; the entry-point declarations with their coverage tests; and the guards (the page header, the `act` wrapper, the route helper), all reading "everything on" until E3b sets something. The 12 scheduled jobs are declared, not guarded (E3c). Explain-back note: `module-entitlements-e3a-explain-back.md`.

**E3b (2026-11-03):** built on the revised design: the switch is a platform setting in the database (two small tables), platform staff only, refused while a company lacks a subscription, REPORT before ENFORCE. Explain-back note: `module-entitlements-e3b-explain-back.md`. Still to do: E3c (turn modules on one at a time, and guard the scheduled jobs), only on your word.
