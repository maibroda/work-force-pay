# Plan: selling WorkforcePay as modules and plans (entitlements)

**Status: step E1 (the catalogue) is BUILT as a library on branch `feature/entitlements-catalogue` (2026-11-03), using my recommended defaults for questions 1 to 7, which the founder accepted. Nothing else is built, and nothing in the app reads the catalogue yet: no migration, no screen, no permission, nothing enforced.** Written 2026-11-02 from the founder's document "Tailoring WorkforcePay to each client". It touches access control, every page and route, navigation and the database, so under `CLAUDE.md` it needs your "go" first, an explain-back note afterwards, and a reversible migration.

## 1. What I understood you want

Each client company gets exactly the modules it pays for: twelve modules, five plans, dependencies between modules (payroll needs only the core; the CRM needs neither HR nor payroll), a configurator that turns a requirements questionnaire into a **blueprint** and quote, a subscription created from that same blueprint when the client signs, safe upgrades and downgrades, enforcement on the server (every route, job and report declares its module), menus that follow what was bought, **read-only (never deleted) after a downgrade or cancellation**, seat and headcount limits, and "ports" so a module works with or without its neighbours (for example payroll takes unpaid leave from HR leave requests if the client has HR, otherwise from days typed on the pay run).

## 2. What exists today (checked in the repository)

- **No entitlement layer.** No module list, plan, subscription, price book, blueprint or limit exists. `Organization` holds a name, code, contact details and currency only.
- **One switch exists:** the sales module is on or off for a company (`CrmSetting.enabled`, off by default), checked on the server in `requireSales` and used to hide the Sales menu (`salesOnly` in `src/lib/nav.ts`). It is the pattern to generalise.
- **Menus** are filtered by permission, by "bureau" mode and by the sales switch (`src/app/(app)/layout.tsx`). The permission check is `assertCan` in `src/server/services/_base.ts`; roles map to permissions in `src/lib/auth/permissions.ts`.
- **Size of what would need a declaration:** 235 pages, 62 server-action files, 28 API routes (9 scheduled jobs) and 84 service files. "Every route declares its module" is therefore a large, mostly mechanical change.
- **The finance roadmap already lists "module switches, terminology layer, industry templates" as Phase 8** (`docs/finance-architecture.md`), described as touching almost every page. This plan is that item, made concrete.
- **Not all twelve modules exist as separate things in the app.** Time and attendance (clocking, shifts, rosters), production pay (piece rates, team pools), sales and service-charge pay (commission, pools), client billing flat-rate pricing and WhatsApp payslips are not built, or exist only in part (a work register, billing rules, receivables). The module list would have to say which are real today.

## 3. Proposed order (each step stops for your "go")

| Step | What | Done when |
|---|---|---|
| **E0. Map** | A written map of the app: every page, action, route and job against a module (a table I produce from the code, for you to correct). Which of the twelve modules exist today. | You confirm the map. No code. |
| **E1. The catalogue** | Modules, dependencies, plans and ports as **data with effective dates and history** (like statutory settings), plus a pure function that, given a set of modules, says what is missing and why. | Unit tests on every dependency and plan combination, including every pair of modules. |
| **E2. Subscription and blueprint tables** | `Subscription` (modules, plan, limits, dates), `ClientBlueprint` (what was sold, linked to the CRM deal), an audit entry on every change. Reversible migration. Existing companies are given **all modules they use today**, so nobody loses anything on day one. | Migration round-trips; a seeded company behaves exactly as before. |
| **E3. Enforcement** | `assertCan` also asks "is this module on for this company?"; navigation hides or greys what is not bought; a **test that fails if any page, action, route or job has no module declaration**. Roll out module by module, behind a switch that is off until you turn it on. | The CI test is green; a company without a module is refused on the server with a plain message. |
| **E4. Configurator** | `configureClient()` (questionnaire to blueprint and quote) and a price book, saved with the proposal and linked to the CRM deal. | Worked quotes agree with figures you work out by hand. |
| **E5. Provision and change** | Create the subscription from the blueprint; `planChange()` for upgrades, add-ons and downgrades, refusing unsafe changes (for example removing payroll while a pay run is open); removed modules become **read-only**, never deleted. | Tests for every unsafe case; data survives a downgrade and an upgrade back. |
| **E6. Limits and ports** | Headcount and seat limits checked when an employee or user is added; the port layer (unpaid leave, attendance, labour cost for quotes, departments) with a fallback for each. | A payroll-only company and an HR-plus-payroll company both run the golden payroll tests. |

E3 is the risky step: a wrong or missing declaration could lock a client out of something it paid for, or leave something open. That is why it comes after the map, behind a switch, with a test that every route is declared.

## 4. What I would not do without your say

- Change payroll, statutory or posted data. The entitlement layer only decides who may use a screen or action.
- Delete anything on a downgrade (the document says read-only; I agree).
- Invent prices, plan membership or retention periods. The price book in the document is "examples only", and the **retention period for removed modules and payroll history is for your tax adviser**.

## 5. Questions for you (these change the design)

1. **Is this for ThreeRoots to sell WorkforcePay to its own clients, or for companies that run WorkforcePay themselves?** The app already has a "bureau" mode (ThreeRoots working in its clients' organizations) and a client portal. Entitlements would sit on the *client organization*, set by the bureau. Is that right? Who may change a client's subscription: only ThreeRoots staff?
2. **The CRM.** The sales module is already a per-company switch and is also the thing ThreeRoots uses to sell. In this plan it becomes the "CRM" module, charged per CRM user. Should the existing switch become an entitlement (a company cannot switch the CRM on unless it was bought), and what should happen to companies that already have it on?
3. **Modules that do not exist yet** (time and attendance, production pay, service-charge pay, WhatsApp payslips): list them in the catalogue as "coming soon", or leave them out until built?
4. **Existing clients on the day this ships:** I propose every current company gets all modules it uses today, at no change, until you decide otherwise. Agreed?
5. **Billing and prices.** Is the price book only used to produce quotes (the app never charges anyone), as the rest of the app "records and calculates but never holds or moves money"? Who owns the real price book, and does it change by date (it should be effective-dated)?
6. **Read-only period** after a downgrade or cancellation, and how long payroll history is kept: to confirm with your tax adviser. Until then I would not delete or hide anything.
7. **The documents' "Try it now" command** (`scripts/configure.ts`, `examples/`) is not in the repository. Do you have those files from somewhere, or should the configurator be written fresh from the description?
8. **Order against the remaining CRM work.** The CRM Phase 9 pull request (#106) and its security findings are waiting on you. I suggest finishing that first; this layer changes the same permission check.

When you answer 1 to 5 and say "go", I will start with **E0, the map**, which needs no code and no migration.

## What E1 built (2026-11-03)

`src/lib/entitlements/catalogue.ts` (the data) and `src/lib/entitlements/resolve.ts` (the rules), with 27 unit tests (`tests/unit/entitlements-catalogue.test.ts`). Pure code, no database.

- **15 modules:** the founder's twelve plus Accounting, Payables and procurement, and Inventory. Each has its needs, what it is charged per, and whether it is built (built, partial, planned).
- **The founder's dependencies, kept exactly:** payroll needs only the core; the CRM needs neither HR nor payroll; production pay and service-charge pay need payroll; client billing needs contracts and deployment **or** the CRM; employee self-service needs payroll **or** HR.
- **What the rules do:** `resolveModules` says what a selection needs and why, in words a salesperson can repeat (an either-or need is met by what the client already has, otherwise the first choice is added and the reason says so; the salesperson may prefer the other); `checkPlan` says whether a plan with add-ons holds together and what to add if not; `whatRemovalBreaks` names what would stop working if modules were removed (an either-or need survives while one choice remains; the core cannot be removed); `portSource` says where each of the four ports gets its answer for a client with these modules, with the fallback.
- **Tested:** every module, **every pair of modules** (105 selections) and 2,000 random selections come out complete, minimal and unchanged when resolved again; payroll alone is core and payroll, the CRM alone is core and CRM; every plan is complete by itself; every port has a source for every selection.

**What I assumed (please confirm or correct):**
1. **Accounting needs only the core; Payables and procurement needs Accounting** (its bills post to the ledger); Inventory needs only the core; all three are charged flat.
2. **"Any plan can take add-ons within its allowed list"**: the document gives no list, so any module can be added to any plan if its needs are met. A restriction per plan can be added later.
3. **Build status** is from the E0 map: Time and attendance, and Employee self-service, are partial (no clocking; no SMS or WhatsApp payslips); Production pay, Sales and service-charge pay and Integrations are planned (not built; there is no public API).
4. **The client portal and the bureau tools are not modules here** (they are guesses in the table awaiting your decision).
5. **One dated version of the catalogue** is kept in the code. Keeping every earlier version with effective dates, as statutory settings are kept, needs a table, and comes with E2.

**Next, E2:** the subscription and blueprint tables (a migration, so it needs your "go").
