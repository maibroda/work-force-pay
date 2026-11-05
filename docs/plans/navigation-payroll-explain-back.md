# Explain-back note: Payroll as one menu entry, merged duplicates, and "Go to"

Branch `navigation-payroll`. **Screen change only: no payroll calculation, statutory rule, permission, entitlement or data change, and no migration.** It touches how pages are *listed*; every page still checks permission and the company's modules on the server, as before.

## What it does

1. **Payroll is one sidebar entry.** The Payroll group had 38 entries. It is now one, "Payroll", leading to the first page the person may open. Inside, every page of payroll shows two rows of tabs: the **jobs** (Run payroll, Pay inputs, Pay setup, Pay out, Tax, pension & schedules, Payroll reports) and, under the job you are on, its pages. Someone who may open only the reports still gets an entry (it leads to the first report they can open); someone who may open nothing sees no entry.
2. **Duplicates merged.**
   - *Payroll Validation, Payroll Approval, Payroll Lock* were three entries that all redirected to the payroll runs page. They are gone from the menu (their addresses still redirect, so old links work); the runs page now has filters "All runs / Awaiting approval / Approved, ready to lock".
   - *End-of-Service Settlements* was in HR Lifecycle and in Payroll (the same page). It stays in HR Lifecycle only.
   - *Salary components* is a view of the salary structures, not a separate function: it is now reached from the Salary structures tab (and still opens on its own address).
   - *The two "Bank reconciliation" pages* do different jobs (matching the bank statement to salary payments, and reconciling the operating account). As you decided, they are **not merged**; they are named so they can be told apart: "Salary payment reconciliation" (Payroll > Pay out) and "Operating account reconciliation" (Finance).
3. **Related pages together.** The contract rates ("Client salary structures & agreed rates", formerly under Finance) now sit beside the salary structures they use, with a link each way; the payroll settings (statutory rules, payroll rules, employer cost rules, recurring deductions) sit in Pay setup instead of among the other settings.
4. **"Go to" search** at the top of every page: type a few letters ("pension", "journal") and jump to the page; press `/` anywhere to start. It lists only pages the person's menu would show them.

## Rules that must still hold, and the tests that prove it

| Rule | Test (`tests/unit/navigation-areas.test.ts`) |
| --- | --- |
| No page is lost: every page of the old Payroll group, and the five brought in, is a tab or sits under one (except Settlements, kept in HR, and the three redirects) | "loses no page" |
| Nobody gains or loses access: each page keeps the permission that showed it before, for every role | "shows nobody a page they could not open before…" |
| A company that has not bought a module does not see its pages in the tabs | "hides a page of a module the company has not bought" |
| The client-inputs tab appears only in a bureau | "is the pages their role may open…" |
| The three redirect pages still redirect | "keeps Settlements in one place… as redirects" |
| Every tab is a real page; none appears twice | "has no page twice…" |
| The search shows nothing for a blank or unmatched query and at most eight results | "the Go to search" |

## A worked example

A payroll officer opens the sidebar: instead of 38 lines under Payroll there is one, "Payroll". It opens Payroll runs. The top row shows Run payroll, Pay inputs, Pay setup, Pay out, Tax, pension & schedules, Payroll reports; under "Pay setup" they see Salary structures, Contract rates, Statutory rules and so on. They press `/`, type "pen" and jump to "Pension" (or "Pension schedule"). An employee-role user sees neither the entry nor any payroll page in the search.

## What I did not do or test

- The tab rows and the search were checked in a browser against the scratch database (see the pull request); I did not test every role in a browser. Role visibility is proven by the unit tests, not by screenshots.
- Only Payroll is done. Finance, Accounting, HR, Leave, Operations, Sales (the two Sales areas become one, as you decided), Settings and My workspace follow, one pull request each.
- The "Go to" search finds pages, not employees or records (an employee search is a separate step).
- Employees already uses its own tab row from #137; it will be moved onto this same mechanism when the other areas are done, so there is one mechanism.
