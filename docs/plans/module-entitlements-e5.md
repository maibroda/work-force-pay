# Entitlements, step E5: provisioning and changing a plan safely (plan)

**Status: a plan only, for the founder's answers and "go". No code, permission, migration or screen is changed by this document.** Written 2026-11-03, after E4a (the configurator) was merged in #128. E5 changes what a company can reach and so is access control: under `CLAUDE.md` it needs your "go", tests first, and an explain-back note. **Nothing is enforced today (every module's switch is OFF), so none of this can lock anyone out until you turn a module on.**

## 1. What E5 must do, in plain words

Let platform staff, or a bureau for its own clients, **move a company between plans and add or remove modules without ever losing its data or breaking work in progress**: refuse a removal that would strand something half done (a pay run waiting for approval, a journal waiting to be posted), keep the removed module's data **readable but not changeable** for an agreed period, and bring everything back intact if the company later takes the module again. And create a company's subscription from an accepted blueprint, so what was sold is what is switched on.

## 2. What exists today (checked in the repository, 2026-11-03)

- **E2 (merged):** `createSubscription`, `addModule`, `removeModule` and `changePlan` already exist. They check dependencies (nothing can be removed that another module the company has needs; the core is never removed), end-date a removed module instead of deleting it, keep every change as an unalterable history entry, and store a `readOnlyUntil` date. Changes are immediate.
- **What they do not check:** whether the company has **work in progress** in the module being removed. Today a company could lose Payroll while a pay run is awaiting approval.
- **E3 (merged):** a module that has ended is **refused outright** once its switch is ON; `readOnlyUntil` is stored and ignored. The plan always said read-only belongs to E5.
- **E4a (merged):** `configureClient` proposes the plan; E4c will save blueprints; nothing creates a subscription from one yet.
- **Work in progress that exists in the schema** (statuses already in use): payroll periods and runs (open through locked and paid), client invoices (draft, submitted, approved), purchase orders (draft, pending approval, approved), manual journals (draft, submitted, approved), accounting periods (open, soft-closed), leave requests (pending), and active sales deals.

## 3. Design I recommend

1. **A read-only check before any removal or downgrade** (`changeBlockers`): for each module being removed, it counts work in progress and returns plain messages ("Payroll: 1 pay run is still in progress (March 2027, waiting for approval). Finish or cancel it first."). **Hard blockers refuse the change; soft ones are shown and need a typed acknowledgement.** The lists per module are yours to set (question 1); my first proposal is in section 5. It reads only; it changes nothing.
2. **Read-only after removal, by kind of entry.** Within the read-only window a removed module's **pages and read-only API routes stay open** and its **server actions and scheduled jobs are refused**. This needs no per-permission classification: in this app every change goes through a server action, and pages and download routes only read. After the window, the module is refused outright (as E3 does now). Data is never deleted at any point.
3. **The window is chosen when the module is removed** (`readOnlyDays`, already stored), with **no default invented by me**: how long payroll and finance history must stay readable is for your tax adviser (question 2).
4. **Taking a module again restores everything** (the data was never touched): a test removes a module, lets it lapse to refused, adds it back, and shows the data and history are all there.
5. **Changes can be dated** (question 3): "from the end of this month" is how a real downgrade is agreed. `modulesOn(date)` already answers any day, so a scheduled change is two rows with dates; what is new is a way to request one and a rule that a scheduled removal is re-checked for work in progress on the day.
6. **Provision from a blueprint** (after E4c): `provisionFromBlueprint` creates the subscription from an accepted blueprint (its plan, add-ons and limits), marks the blueprint accepted, and writes the history entry naming the blueprint. A company that already has a subscription is changed with `changePlan`, not re-created.

## 4. Steps (each stops for your word)

| Step | What | Migration |
|---|---|---|
| **E5a** | `changeBlockers` and its tests (one test per blocker and per module); `removeModule` and `changePlan` refuse on a hard blocker and report the soft ones. | None |
| **E5b** | The read-only window in the guards (pages and read routes open, actions and jobs refused), with the "take it back" round-trip test. | None |
| **E5c** | Dated changes, `provisionFromBlueprint`, and the screen for a change with its blockers shown. | Possibly one column |

## 5. What I need from you (these change the design)

1. **What blocks a removal.** My first proposal (hard unless marked soft): **Payroll**: any pay run not yet locked or paid, or a payment batch awaiting confirmation. **Accounting**: a journal awaiting approval or posting, or a period still being closed. **Payables and procurement**: a purchase order pending approval, or a bill awaiting match. **Client billing**: an invoice awaiting approval (soft: unpaid issued invoices, which stay readable). **CRM**: none hard (soft: open deals and queued automation). **HR**: none hard (soft: pending leave requests, open onboarding or exit tasks). **Inventory**: none hard (soft: stock currently issued to employees). **Others**: none. Which of these are hard, soft or not blocking?
2. **How long removed data stays readable** (the read-only window), and the minimum for payroll and finance history. **For your tax adviser; I will not invent it.** Until you give a number, removal would require platform staff to type one and would offer no default.
3. **Do changes take effect now, or from a chosen date** (usually the end of the month)? My recommendation: both, with a date as the normal way and "now" needing a reason.
4. **Does a downgrade need a second person to approve** (a platform administrator other than the one who asked)? Today one platform user can change a subscription, and it is audited. My recommendation: not yet, but record it as a risk, and revisit when you have more than a few platform staff.
5. **Users in the middle of something.** When a module ends, a half-written draft in it becomes unchangeable. Is that acceptable (my recommendation, since the blockers already stop real work being stranded), or should drafts also block?

## 6. Risks and what this step does NOT do

- A blocker list that is too short strands work; too long, and a company cannot leave. The lists are yours, and each blocker has its own test.
- Read-only by entry kind is simple, but an action wrongly filed as a page would stay open: the E3 declarations and tests already pin every entry's kind, and E5b adds a test that no page or route writes.
- Not in E5: limits and their checks (E6), prices (E4b), turning any module on, deleting any data, any change to payroll, statutory or posted data.

## 7. If you say "go"

I would start **E5a** (no migration, no behaviour change while the switch is OFF): tests first, then `changeBlockers`. It needs your answers to questions 1 and 5 first, because the lists are yours.
