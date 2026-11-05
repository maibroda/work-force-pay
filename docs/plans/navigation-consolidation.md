# Plan: fewer menu entries, no duplicate pages, easier navigation

Written 2026-11-04 from the founder's review ("there are functions that overlap: merge them and make it one; there are so many modules and pages that it is boring and makes working on the app difficult; make it easy to navigate"). **This is a plan only. Nothing is built until you say "go". It changes screens and menus only: no payroll, statutory, permission, entitlement or data rule changes, and no migration.**

## 1. What I found (counted from `src/lib/nav.ts` and the pages, 2026-11-04)

- **About 170 sidebar entries in 13 groups, over 239 pages.** The largest groups: Payroll 38, Finance / Accounting 30, Settings 20, Sales (CRM module) 18, HR Lifecycle 16, Operations 14. Two separate groups are both called "Sales".
- The Employees group is already done the way proposed below (one entry, sections inside it, #137), and you accepted that shape.
- **Pages that do the same thing or lead to the same place:**

| What | Where it appears | What is really there |
| --- | --- | --- |
| Payroll Validation, Payroll Approval, Payroll Lock | three Payroll entries | all three just redirect to the **payroll runs** page (filtered). They are steps of one run, not three functions |
| End-of-Service Settlements | HR Lifecycle **and** Payroll | the same page twice |
| Journal Entries, Manual Journals, Recurring Journals, Journal Reversals | four Accounting entries | four views of journals: the ledger, drafting, templates, reversals |
| Bank Reconciliation | Payroll > Payments **and** Finance | **two different jobs with one name:** matching the bank statement to *salary payment transactions*, and reconciling the *operating account* to imported statements |
| Leave Management, Leave Balances, Leave Policy | three entries | one subject |
| Leads | Sales module **and** the bureau's Sales pipeline | two systems by design (the CRM rules in CLAUDE.md say they never share files or permissions), but the same word on two menus |
| Clients | Bureau, Finance, and Sales "Accounts" | three different records of a client in three places |
| Earnings / Deductions / Overtime / Arrears and the "reports" of the same names | Payroll | an input page and a report page per subject, listed side by side |
| Training Compliance (HR), Training & Certifications (Workforce), Employee Training report | three places | one subject |
| Reports | a report list in the sidebar group **and** a Reports hub | the same reports reachable two ways |

## 2. What I propose (the Employees pattern, applied to every module)

1. **One sidebar entry per area, with the sections inside it as a row of tabs** (as done for Employees). The sidebar becomes about **14 entries** instead of about 170: Dashboard, Employees, HR, Leave, Payroll, Payments, Operations, Clients & contracts, Finance, Accounting, Sales, Analytics & reports, Settings, My workspace (plus the bureau's own: Clients, Service desk). Each person sees only the entries their role and plan allow, as now.
2. **Merge the duplicates in section 1:** each page is reachable from **one** place. Payroll Validation, Approval and Lock become one **"Payroll runs"** page with status tabs. Settlements lives in HR and Payroll links to it. The four journal pages become one **Journals** page with tabs. Leave becomes one entry with Balances and Policy as tabs. Training appears once.
3. **Group by the job, not by the table.** For Payroll, for example: *Run payroll* (periods, runs, supplementary, payslips), *Pay inputs* (earnings, deductions, loans, overtime, arrears, client inputs), *Setup* (structures, components, calendar), *Pay out and remit* (payments, bank list, paying banks, reconciliation, statutory remittance), *Schedules and reports* (PAYE, pension, NHF and the rest, once each).
4. **A "Go to" search box at the top** (press `/`): type "pension", "journal", "ada" and jump to a page or an employee. It lists only pages the person may open. This is the biggest help for someone who does not know where a function lives.
5. **Addresses do not change.** Every page keeps its address, so bookmarks, links in emails, and the module on/off checks keep working. Old redirects stay.

## 3. Order of work (one pull request each, tests first)

1. The navigation model and the tab-row component made general (extending what #137 built), plus the **"Go to" search**.
2. **Payroll** (38 entries to one, and the three-way duplicate).
3. **Finance and Accounting** (30 to two; the four journal pages become one).
4. **HR, Leave, Operations** (and the settlements duplicate).
5. **Sales and the bureau** (after your answer to question 3).
6. **Settings** (20 entries to one with sections) and **My workspace**.

Each step is checked against: every page that was reachable is still reachable by the roles that could reach it; no page appears for a role or plan that was refused it before; the module on/off checks are unchanged.

## 4. What I need from you

1. **"Overlapping functions":** did you mean **pages and menu entries** (what this plan covers), or also **duplicated code** underneath? Duplicated code I would list in a findings note and not rewrite, because rewriting pay code is risky and you must be able to explain it; say if you want otherwise.
2. **Go-ahead and order:** is the order in section 3 right (Payroll first)?
3. **The two Sales areas:** keep them as two entries ("Sales" for the CRM module and "Bureau sales" for ThreeRoots's own pipeline), or combine them into one menu entry that shows whichever the company has? Keeping the data and permissions separate is already the rule; this is only about the menu.
4. **Bank reconciliation:** one menu entry "Bank reconciliation" with two tabs (salary payments / operating account), keeping the two functions separate underneath? (I do not recommend merging the two into one engine: they match different things.)
5. **Reports:** keep the sidebar's report lists, or move all reports into one "Reports" area with a search? I recommend one area.

## 5. What this does not do

No payroll calculation, statutory rule, permission, entitlement or data changes; no migration; no page is deleted. Pages that are only redirects (Approval, Lock, Validation) stay as redirects so old links work.
