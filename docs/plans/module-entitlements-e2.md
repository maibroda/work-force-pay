# Plan: entitlements step E2, a subscription for each company

**Status: a plan, with the founder's answers of 2026-11-03 recorded at the end (they accepted my recommendations). The founder's "go" for E2 was given in the same reply. Nothing is built yet, and no migration is written.** Written 2026-11-03. It follows `docs/plans/module-entitlements.md` (the overall plan) and builds on E1, the catalogue of modules, plans and ports, which is merged (`src/lib/entitlements/`). E2 adds database tables, so under `CLAUDE.md` it needs your explicit "go" and a reversible migration; it touches who may change what a company can use, so it is access-control work and gets an explain-back note.

## 1. What E2 is, and what it is not

**It is:** where the app keeps, for each company, **which plan and which modules it has bought, since when, and who changed it**, plus a place to save the **blueprint** of what was sold to a prospect. Every change is recorded and can be traced.

**It is not:** enforcement. After E2 **nothing is switched off**: the app does not yet ask the subscription before showing a page or running an action (that is E3, behind a switch that stays off until you turn it on). After E2 every existing company simply has a subscription recording "everything it uses today", so that when E3 arrives nobody loses anything on the day it is switched on.

## 2. What exists today (checked)

- A company is an `Organization`. A payroll bureau is one with `isBureau`; its clients are organizations whose `bureauOrganizationId` points at it. ThreeRoots staff work inside a client through bureau mode (`ctx.homeOrgId`).
- `SUPER_ADMIN` and `COMPANY_ADMIN` hold every permission. There is **no permission about subscriptions**, and **no table** for plans, modules or limits. The sales module has its own on/off switch (`CrmSetting.enabled`) which E3 will fold into this.
- The catalogue (E1) lists 15 modules and five plans in code, with a dated version string.

## 3. What E2 would add

**Four tables** (one migration, reversible):

| Table | Holds |
|---|---|
| `Subscription` | One for each company: its plan (a key from the catalogue), the **catalogue version** it was made against, status (ACTIVE, READ_ONLY after a downgrade or cancellation, CANCELLED), start and end dates, and optional limits (employees, CRM users). |
| `SubscriptionModule` | The modules a subscription includes, **each with the day it started and the day it ended, why it is there** (PLAN, ADD_ON, NEEDED_BY another module, or GRANDFATHERED), and, when a module was removed, until when it stays read-only. These rows are the history. |
| `SubscriptionEvent` | Every change, **append only** (the database refuses to change or delete a row, as for consent and audit): who, when, what changed (module keys and plan, never personal data), and the reason given. |
| `ClientBlueprint` | What was proposed to a prospect: the questionnaire answers, the modules and plan chosen, the reasons dependencies were added, and (later, in E4) the quote. Optionally linked to a CRM deal. **Only the table in E2**; the configurator that fills it is E4. |

**Rules, enforced in the service and tested:**
- A subscription's modules must be **complete** under the catalogue (every need met), checked by the E1 rules; one that is not is refused with the reason.
- A module is **never deleted**: removing one ends its row and records an event. (Data in the module is untouched; "read-only, not deleted" is the founder's rule.)
- Every change writes a `SubscriptionEvent` and an audit entry (ids and keys only).
- **Who may change a subscription:** see question 1. A company's own administrator may **see** its subscription.
- **No subscription means "everything"** while enforcement is off (see question 2), so a new company created by any route keeps working.

**One data step in the migration (the one with risk):** for **every company that exists when it runs**, create a subscription on the **Custom** plan, status ACTIVE, with **every module that is built or partly built** (not the three that are only planned: production pay, service-charge pay, integrations), each marked GRANDFATHERED, so what a company uses today is exactly what its subscription says. `down.sql` removes these rows. This is not a destructive change, but it writes a row for every company, so it is tested on the seeded database and round-tripped before it goes anywhere.

## 4. What I will build, in order (each step stops for your "go")

1. **Tests first:** the rules above (completeness, never deleted, events append-only and refused by the database, who may change, tenant isolation: a company cannot see or change another's subscription, grandfathering gives every existing company exactly its current modules, history is reconstructible for any past date).
2. **Migration** with `down.sql`, round-tripped (and the grandfathering step tested on a database that already has companies).
3. **The service:** read a subscription (and which modules were on at a date), change plan, add or remove a module (using the E1 rules), all audited.
4. **A read-only page** for a company's administrator (Settings, Subscription): the plan, the modules and their status, the history. **No edit screen yet**; changes through E5's `planChange`.
5. Release notes, data dictionary, explain-back note, full suite, build and smoke test; then stop.

## 5. What I will not do in E2

Enforce anything, hide any menu item, refuse any action, change any price, or touch payroll, statutory settings or posted data. The sales module's own switch is left as it is until E3.

## 6. Questions for you

1. **Who may change a company's subscription?** My recommendation: a new permission `subscription.manage` held by **`SUPER_ADMIN` (platform staff) and by a bureau's administrator working inside one of its clients**; a company's own administrator can only view (`subscription.view`). That fits "ThreeRoots sets each client's subscription" (your earlier default). Alternative: `SUPER_ADMIN` only.
2. **What does a company with no subscription get while enforcement is off, and when it is on?** My recommendation: **everything** while it is off (so nothing can break); when E3 turns it on, a company without a subscription is treated as having **only the core**, and you decide per company whether to give it one. Is that right, or should a missing subscription always mean everything?
3. **Limits** (employees, CRM users): store the fields in E2 but **check them only in E6**, as planned? (Yes is my recommendation; the field is unused until then.)
4. **A bureau's clients:** does a bureau's own subscription cover the clients it manages, or does each client have its own? My recommendation: **each company has its own**, and a bureau simply has permission to change its clients'.
5. **Grandfathering:** the "Custom plan with every built module" starting point is mine. Would you rather existing companies be put on **Workforce Suite** (which includes the three planned modules too) or on a plan you choose per company?
6. **Prices and the price book are not in E2** (they belong to the configurator, E4). Agreed?

## 7. The founder's answers (2026-11-03: they accepted my recommendations)

1. **Who may change a subscription:** platform staff (`SUPER_ADMIN`) and a bureau's administrator inside its own clients; a company's own administrator can only view. **One trap, to be built and pinned by a test:** `COMPANY_ADMIN` holds every permission automatically, so `subscription.manage` must be explicitly **withheld** from it, or any company could give itself every module.
2. **A company with no subscription:** everything while enforcement is off. When it is switched on, a missing subscription means the core only, **and every way of creating a company also creates a subscription, and the switch refuses to turn on while any company lacks one** (so a new company can never be locked out by the switch).
3. **Limits:** the fields are stored in E2 and checked only in E6.
4. **A bureau's clients:** each company has its own subscription; a bureau has permission to change its clients'.
5. **Grandfathering:** existing companies are put on the Custom plan with every module that is built or partly built (not the planned ones), each marked grandfathered, so they can be reviewed and given real plans later.
6. **Prices:** not in E2.

**Added by the ruling that the client portal is a module:** the migration's grandfathering step includes it (it exists today), and the catalogue has 16 modules.
