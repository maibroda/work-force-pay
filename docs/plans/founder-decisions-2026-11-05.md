# Decisions of 2026-11-05 and what I will build next

Recorded from the founder's last message: the **office salary-structure percentages** were given (Basic 25%, Housing 25%, Transport 20%, others 30%), and for the **paid-days questions, unpaid leave and the HR gap-analysis decisions** the founder asked me to **make the recommendations**. Each recommendation below is mine, taken as the decision unless the founder changes it. **Items that change pay or need a migration still wait for the founder's "go" before I build them.** Status: paid days and unpaid leave are built (pull request #153); the HR items in section 4 are not built yet.

## 1. The office salary structure (given by the founder)

| Component | Percentage | Taxable | Pensionable |
| --- | --- | --- | --- |
| Basic | 25% | yes | yes |
| Housing | 25% | yes | yes |
| Transport | 20% | yes | yes |
| Other allowances | 30% | yes | no |
| **Total** | **100%** | | |

**Flags confirmed by the founder (2026-11-05): Basic, Housing and Transport are pensionable and taxable.** The other allowances are taxable and not pensionable, as in the company's existing default structure. If "others 30%" is several components (for example Meal, Utility, Medical), say so and I will list each with its own percentage. **How to enter it today:** Payroll > Pay setup > Salary structures > "Create salary structure": code OFFICE, name "Office Staff Structure", those four components, then Activate. A personal pay rate for an office employee then names this structure (or a company-wide default is chosen per employee).

## 2. Paid days (the five questions in `docs/plans/paid-days-basis.md`): my recommendations, adopted

1. **Working week:** use the company's existing setting "working days per week" (Monday to Friday by default, 22 days in a typical month) as the default for a contract on the working-days basis, with an **optional override on the contract** for a Monday-to-Saturday client.
2. **Public holidays:** the **company enters the dates each year and confirms the year** (who confirmed and when). I put no holiday dates in the code (some are announced each year). A contract that excludes public holidays cannot be paid for a month in a year that is not confirmed.
3. **Who may change a contract's basis:** **a second person approves**, as for personal pay rates (the payroll manager), effective-dated, history kept.
4. **A person who moves between contracts with different bases in one month:** **flagged for review**, not paid on a guess.
5. **Overtime on a public holiday or weekend:** through the **existing approved-overtime route and its rates**. On a working-days contract a weekend or holiday day adds no basic pay.

## 3. Unpaid leave (the founder's question 6): my recommendation

- **Built in pull request #153 (2026-11-05), with one change from this recommendation.** Until now every leave day counted as a paid day and there was no unpaid leave. A leave request can now be **paid (annual leave, as before) or unpaid**, once the company switches "Allow unpaid leave" on in the leave policy (off by default). I did **not** add a new attendance status: an approved unpaid working day is simply **left out of the paid days** and writes no work-register row, which gives the same effect on pay without altering the attendance list.
- **Pay:** an unpaid day reduces pay exactly as an absent day does (the monthly gross multiplied by days paid, divided by the basis days). **Pension, PAYE and NHF follow the reduced pay automatically; there is no special statutory treatment.** On a working-days contract only working days count.
- **Leave balance:** unpaid leave does **not** use up the annual-leave entitlement. It needs the same approvals as other leave, and the payslip shows the unpaid days.
- **Which requests are unpaid** is the employee's (or HR's) choice on the request, allowed only when the company's leave policy has unpaid leave switched on.
- **Not built yet:** the payslip does not list the unpaid days (it needs a stored field on the payroll record).

## 4. HR gap-analysis decisions (`docs/plans/hr-module-gap-analysis.md`): my recommendations, adopted

1. **Split Disciplinary from Employee relations: yes.** Keep the one case engine; give **Disciplinary its own page, list and permission** (misconduct cases and the sanctions queue) and leave Employee relations to grievances, harassment, whistleblowing, counselling and mediation, with **two permissions** so a person handling grievances need not handle discipline.
2. **Performance management order:** job descriptions and KPIs with weights and targets feeding the appraisal; then a **structured PIP workflow**; then continuous feedback; then a **probation review that ends in a confirmation decision** linked to the employment contract (confirm, extend, fail); then analytics.
3. **Promotion and salary review:** an **HR person proposes, a second person approves; a pay change goes through the existing pay-rate proposal and approval (the payroll manager)**. An appraisal recommendation is an input only, never an automatic raise. A simple **"within the approved budget" confirmation** by the approver, not a numeric budget, to start.
4. **Compensation framework:** keep your framework as **separate professional work**, as the review advises. I can build **grades and bands as data** and the salary-review workflow without it, later.
5. **Next after performance management:** **Learning & development** first (training needs and a calendar, because training records already exist), then **welfare and recognition**, then **career and succession**.

## 5. What I will build, in this order (each its own pull request, tests first)

| # | What | Needs your "go" because |
| --- | --- | --- |
| 1 | **Disciplinary separated from Employee relations** (screens and permissions, no new data model) | access-control change |
| 2 | **Paid-days basis per contract** (calendar or working days, the holiday calendar, the engine change) | pay engine and a migration |
| 3 | **Unpaid leave** | pay engine and a migration |
| 4 | **Performance management**: job descriptions and KPIs, then PIP, then feedback, then the probation review | new data and workflows |
| 5 | **Promotion and salary-review workflow** | touches pay |
| 6 | **Learning & development**, then welfare, then career and succession | new modules |

I suggest starting with 2 and 3 together (they share the "paid days" change and the work-register status) after you confirm section 1's flags.
