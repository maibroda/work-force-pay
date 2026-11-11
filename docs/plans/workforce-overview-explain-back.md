# Explain-back note: the Workforce overview

For the founder. Plain language. This is a **read-only** analytics page; it changes no record and moves no money. It shows pay figures, so I treat it as touching access control and personal data and explain it as such.

## What it does, step by step

1. **Who may open it.** Only people who hold `analytics.view`, the same right that opens Workforce cost and the other Analytics pages. The server checks it on every request. In the demo company the HR administrator is refused (it does not hold that right) and the Company Administrator can open it.
2. **Whom it counts.** Active and on-leave employees of the caller's company only. An exited or terminated person is never counted. Every query is scoped to the caller's company.
3. **What it reads.** Only the fields it counts: the person's role, department, deployment site, employment date, active contract type and whether others report to them. **No name, no employee number, no bank detail.** It returns counts, shares and averages, never a row about a person.
4. **Pay.** For each person in view it takes the **monthly gross** from the latest regular payroll run (the same run the other analytics pages use). It never returns that figure for a person; it only averages.
5. **The five-person rule.** An average of pay is shown for a group only if **at least five people in it have a pay figure** (the same minimum as the welfare summary and the survey results). Below five the page shows "Fewer than 5 with a pay figure" and leaves the group out of the pay chart. So an average can never be one person's pay.
6. **Exact money.** An average is worked out in whole kobo and rounded half up once, through the shared exact-money helpers. Percentages (shares, comparison with the company) are whole-number arithmetic rounded half up. Nothing uses floating-point money.
7. **Tenure.** Whole years completed on today's date (the anniversary itself completes the year), grouped into under 1, 1 to 3, 3 to 5, 5 to 10 and 10 and over; the average is in years to one decimal.
8. **Filters.** Deployment site, role, department and contract type narrow every figure; the "company average" in the site table is the average of the filtered view.

## Worked example (from the tests)

A test company has nine people in view: seven security guards and two office staff. Five guards at Alpha Plaza and one on leave are paid 100,000.00; the guard at Bravo Mall 150,000.50; the two office staff 200,000.00. In kobo that is 115,000,050 over 9 people = 12,777,783.33, rounded half up to **12,777,783** (₦127,777.83). The security guards (seven with a figure) average 10,714,292.86, shown as **₦107,142.93**. The office staff have only two figures, so their average is **hidden**; so is Bravo Mall's (one figure). Alpha Plaza's average, ₦100,000.00, is 22 percent below the company's, shown as **-22%**.

## What could go wrong, and which test proves it does not

| Risk | Test |
| --- | --- |
| A role without the right opens the page | `workforce-overview.test.ts` ("who may open it"): every role is checked against `can(role, "analytics.view")` |
| An average reveals one person's pay | the five-person tests: a group below five is hidden by role, by site, by the headline figure and when filters narrow the view |
| A name or an individual pay figure leaves the service | "holds no name and no individual pay figure": the result is searched for names, numbers and the pay field |
| Another company's people or payroll run leak in | the tenant-isolation test: counts are the caller's only, and another company's run id gives no pay figure and no error |
| An exited person is counted | the headcount test (an exited employee is created and not counted) |
| Rounding drifts | the unit tests on the helpers and the kobo figures above |

## Assumptions and what I did not do

- **Assumptions (confirmed by your "go"):** the five-person minimum on pay averages; the same people as Workforce cost may see it; role instead of level (we hold no seniority level).
- **Not built:** a seniority level on employees (a separate, larger change), choosing an earlier payroll run on this page, an export, a trend over time.
- **Checked in a browser** against the demo company: the Company Administrator saw 109 people, the charts, the site table and the filters; the "Not deployed" view showed six people with the pay average hidden ("Fewer than 5 with a pay figure"); the phone-width layout has no horizontal overflow; the HR administrator was refused. **Not checked:** other roles' views of the page.
