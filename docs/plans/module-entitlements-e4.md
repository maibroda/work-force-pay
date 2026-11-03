# Entitlements, step E4: the configurator and quotes (plan)

**Status: a plan only, for the founder's answers and "go". No code, permission, migration or screen is changed by this document.** Written 2026-11-03, after E3 (enforcement, with the switch left OFF) was merged in #122, #123 and #124. Quotes involve money, so under `CLAUDE.md` everything here is exact (whole kobo, round half up once, through `src/lib/money-exact.ts`) and **no price is invented**: the numbers are yours.

## 1. What E4 must do, in plain words

Turn a salesperson's answers about a prospect (how many employees, whether they need HR, deployment, a CRM, accounting, and so on) into **a blueprint**: the plan and add-ons that fit, with the reasons in plain words ("Client billing needs Contracts and deployment or the CRM, so the CRM was added"), and **a quote**: what it costs per month, worked out from a price book you own. The blueprint is saved, so what a client was told can be shown later, and it is what E5 will use to create the subscription. **The app never charges anyone.**

## 2. What exists today (checked in the repository, 2026-11-03)

- **E1 (merged):** the catalogue and the rules (`resolveModules`, `checkPlan`, `planModules`, `whatRemovalBreaks`) already work out what a selection needs and give the reason in words. E4's questionnaire only has to turn answers into a selection and call them.
- **E2 (merged):** `ClientBlueprint` already exists (selling organization, plan, modules, answers, reasons, status DRAFT / SENT / ACCEPTED / DROPPED), empty and with no screen. **It links to a company-sales deal (`CrmOpportunity`), which I now doubt is the right link** (question 2).
- **No price book exists, anywhere.** The catalogue records how each module is *charged* (included, per active employee, per CRM user, or flat) but no amount.
- **Two things already called "quotes" or "packages", which E4 must not be confused with:** the company sales module's `CrmQuote` (guard-hours quotes for a company's own clients, with margin rules) and the bureau's service packages (`PAYROLL_ESSENTIALS`, `PAYROLL_COMPLIANCE`, `MANAGED_PAYROLL_PLUS`, `ENTERPRISE`, `HEALTH_CHECK`: what ThreeRoots's people do for a client). **"Payroll Essentials" is also the name of a software plan**, and onboarding gives every new bureau client the software plan of that name by default (my E2 assumption).

## 3. Design I recommend

1. **A pure function** `configureClient(answers)` in `src/lib/entitlements/`, no database: answers in; plan, add-ons, reasons and any problems out. It reuses the E1 rules and never makes up a rule of its own. Tested on every plan and a table of worked cases that I give you to check by hand.
2. **A price book as data, effective-dated, with history and "verified by / on"**, exactly like the statutory settings (rule 3 of `CLAUDE.md`), changed only by platform staff and audited. Amounts in exact decimals. **I enter no amounts**: you give them, or I build it empty and the screen says "no price set".
3. **A quote function** `priceBlueprint(blueprint, headcount, crmUsers, priceBook, date)`: the line for each module (its charge basis times its quantity, flat ones once), a minimum monthly fee if you want one, and a total, all in exact kobo, with the price book version it used saved on the blueprint so a later price change never rewrites an old quote. Worked examples are produced as a table for you to check against your own figures.
4. **A screen** (platform staff and the selling bureau only): the questionnaire, the resulting blueprint with its reasons in words, the quote, and Save, Send (marks it sent; the app sends nothing itself) and Drop.
5. **Nothing is switched on or changed for any company.** Creating a subscription from a blueprint is E5.

## 4. Steps (each stops for your word)

| Step | What | Migration |
|---|---|---|
| **E4a** | `configureClient` and its tests, with a worked-case table for you to check by hand. Pure code. | None |
| **E4b** | The price book (effective-dated, versioned, platform staff, audited) and `priceBlueprint` with worked quotes. | Small, reversible |
| **E4c** | The screen, saving the blueprint, status changes, and the link to wherever it belongs (question 2). | Possibly a link column |

## 5. What I need from you (these change the design)

1. **The questionnaire.** The founder's document mentioned a "Try it now" command (`scripts/configure.ts`, `examples/`) that is not in the repository. **Do you have those files, or the list of questions and what each answer means (headcount bands, sites, "do they run a CRM", and so on)?** If not, I would write a first list of about eight questions from the catalogue and you edit it. I will not guess the rules that map answers to modules without your list.
2. **Where a blueprint belongs.** I linked it to a company-sales deal in E2. ThreeRoots, however, sells through the **bureau's own pipeline (leads and proposals)**. Which is right: (a) the bureau's lead / proposal (my recommendation, since ThreeRoots is the seller), (b) the company-sales deal, or (c) neither, a stand-alone blueprint? (a) or (c) needs a small change to the E2 table.
3. **The price book.** Who owns it, in what currency (NGN?), and is it only for quotes? What charge basis for each module, per active employee, per CRM user or flat (the catalogue has my assumptions; they are for you to change), and is there a **minimum monthly fee and any volume discount**? Does the price change by date (I would make it effective-dated)?
4. **Bureau packages and software plans.** Should choosing a bureau service package (for example `PAYROLL_ESSENTIALS`) imply a software plan, and should the two have different names so nobody confuses them? Today a new bureau client is given the software plan "Payroll Essentials" whatever package it signs.
5. **Who may configure and price.** Platform staff only, or also the bureau's sales people (`BUSINESS_DEV`) for their own prospects?

## 6. Risks and what this step does NOT do

- A quote that is wrong in kobo is a promise broken: every figure is exact, worked cases are shown to you before anything depends on them, and the price book version used is stored with each quote.
- A wrong rule in the questionnaire sells a client a plan that does not hold together: the E1 checks refuse such a plan and say why, and the reasons are shown to the salesperson.
- Not in E4: creating or changing a subscription (E5), limits (E6), turning any module on, any invoice or receipt, any change to payroll, statutory or posted data.

## 7. If you say "go"

I would start **E4a** (no migration, no money): tests first, then `configureClient`, with the table of worked cases. It needs your answer to question 1 first, because the questions and rules are yours.
