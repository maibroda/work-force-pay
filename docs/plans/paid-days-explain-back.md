# Explain-back note: the paid-days basis agreed with each client, and unpaid leave

Branch `paid-days-build`. One migration, `20261124090000_paid_days_basis_and_unpaid_leave` (three new tables, an enum, and two additive columns). **This changes the pay engine's divisor and which days count as paid days, so it needs your review.** Built on your decisions of 2026-11-05 (`docs/plans/paid-days-basis.md`, `docs/plans/founder-decisions-2026-11-05.md`).

## The rule, in payroll words

A month's pay is **the monthly gross multiplied by the days paid, divided by the month's divisor**. Until now the divisor was one company-wide setting: the days in the month, or a fixed 30. Now **each contract can say how it is divided, as agreed with the client**:

- **No setting (every existing contract):** the company's rule, exactly as before. Nothing changes until someone sets and approves a basis.
- **Calendar days:** the days in the month (31 for January, 28 or 29 for February, 30 for April).
- **Working days:** the working days in the month (for example 22). The working week is the contract's own (5, 6 or 7 days) or, if it sets none, the company's "working days per week" in the leave policy (Monday to Friday). Optionally **the confirmed public holidays are not working days**.
- **On the working-days basis a weekend or holiday day adds no basic pay**, even if the person worked it: that work is paid only through the existing **approved overtime** route. Only working days that were paid (present, late, on leave, off) count. Because the divisor is the number of working days, **pay on this basis can never exceed one full gross** (the cap you chose).

## Who sets it, and when it takes effect

1. Someone who manages clients **proposes** it on **Clients & contracts > Paid days** (contract, basis, week, holidays yes or no, the first day of a month, a reason).
2. A **second person, the payroll manager, approves** it. The proposer cannot approve their own proposal. **A pending or rejected proposal never changes pay.** Approval closes the contract's previous setting the day before; a setting that would start on or before an existing one is refused. History is kept.
3. It takes effect **from the first day of a month**, and **the setting in force on the first day of the pay month applies to the whole month** (a change cannot split a month).

## Public holidays

The **company enters its holidays each year** (**Payroll > Pay setup > Public holidays**) and a payroll manager **confirms the year**. No date is built into the code. Adding or removing a holiday un-confirms the year. **If a contract excludes public holidays and the year is not confirmed, the pay run raises a critical finding** ("holidays unconfirmed") that blocks submission until the year is confirmed and the payroll is recalculated.

## A person who worked on contracts with different bases in a month

The system does not guess. The person is **paid on the company's rule** and the run raises a finding that needs a written explanation (the pay is reviewed by a person).

## Unpaid leave

The company switches it on in the **leave policy** ("Allow unpaid leave", off by default). An employee (or HR for them) can then ask for **unpaid leave**; it needs **no annual entitlement** and **does not use up annual leave**. Once **approved**, its **working days are not paid days** in the pay run (the same effect on pay as an absence), for a person on the work register and for one on a personal pay rate. Pension, PAYE and NHF follow the reduced pay with **no special rule**. Unpaid leave writes no work-register days, and an approved unpaid request in a locked period cannot be approved or cancelled. *(A change from my recommendation: I did not add a new attendance status, because leaving the days out is enough and avoids altering the attendance list.)*

## A worked example (November 2026: 30 days, 21 Monday-to-Friday working days; a guard's operative gross is ₦70,000)

- **Calendar basis (or the company's 30-day rule):** a guard who works the 21 weekdays earns 21/30 of ₦70,000 = ₦49,000.
- **Working-days basis:** the same guard earns 21/21 = ₦70,000. A guard who works all 30 days, weekends included, also earns ₦70,000, **not more**; the nine weekend days are for overtime. A guard who misses 2 working days but works 4 weekend days earns 19/21 of ₦70,000 = **₦63,333.34** (the nine earnings lines are each rounded to the kobo, as always, so they add to ₦63,333.34).
- **Holidays excluded, 10 November a holiday:** 20 working days; a guard who takes the holiday off and works every other working day earns ₦70,000.
- **Unpaid leave:** five working days of unpaid leave in a 31-day month on the 31-day rule: 26/31 of the gross.

## What could go wrong, and what proves it does not

| Risk | Test |
| --- | --- |
| Existing contracts' pay changes | the full characterization and golden payroll datasets run unchanged in the full suite; "changes nothing when no day is set aside" (engine test) |
| Pay exceeds one gross on the working-days basis | engine tests: works every day, still one full gross |
| A pending proposal changes pay, or one person does both steps | integration: "changes nothing until approved", "someone else" |
| A mid-month change splits a month | integration and unit: only the first day of a month is accepted; the basis at the start of the month applies to the whole month |
| A holiday that is not confirmed slips through | integration: critical finding until confirmed |
| A person on two bases is paid on a guess | integration: flagged and paid on the company's rule |
| Unpaid leave pays, or uses annual leave | integration: reduces pay for register and pay-rate staff; balance untouched |
| Another company sees or changes these | integration: not found |
| The migration loses data | round trip on a copy of the test database |

## What I did not do or test

- **Not built:** the **payslip does not yet list the unpaid days** (it would need a stored field on the payroll record); the Paid days and Public holidays screens were checked in a browser against the test database, not every role; **billing** uses the same days factor the pay uses, but I did not add a separate invoice test for the working-days basis.
- **Assumption:** a basis change takes effect only from the first day of a month; the basis in force at the start of the month governs the whole month.
- An unpaid-leave request still cannot start in the past (as for annual leave).
