# Plan: the paid-days basis agreed with each client (calendar days or working days)

Written 2026-11-05 from the founder's answers the same day. **This changes how a month's pay is divided, so it touches the payroll engine. It needs a database migration. Nothing is built until you say "go", and I need your answers in section 5 first.**

## 1. What the founder decided

- A month's pay can be divided **two ways, depending on what was agreed with the client**: the **days in the month** (31 for January, 28 or 29 for February, 30 for April) or the **working days in the month** (for example 22), "sometimes excluding public holidays", when **overtime is paid for working on a public holiday**.
- It is **set on the contract** (effective-dated).
- **Staff with no contract** (office staff paid a personal gross) use **the company's default setting**, as today.
- **If someone works more days than the working days in the month, pay is capped at the full gross; extra days are paid only as overtime.**
- Still open from before: the office salary structure percentages (the founder will supply them), and unpaid leave.

## 2. What exists today (checked in the code)

- A company-wide payroll rule (effective-dated) picks the divisor for everyone: the days in the month (CALENDAR_DAYS) or a fixed 30 (FIXED_30).
- The engine pays a person the monthly gross multiplied by days paid divided by that divisor. Days paid are the work-register days with a paid status (present, late, leave, off). **The engine already caps at a full month** (`divisor = max(basis days, days paid)`).
- A person with a personal gross and no register is paid for every calendar day employed.
- There is **no public-holiday calendar** and no basis on a contract.

## 3. The design

**Data (one migration, reversible, nothing existing changes):**
1. `PaidDaysBasis`: COMPANY_DEFAULT, CALENDAR_DAYS, WORKING_DAYS.
2. `ContractPayBasis`: a contract's basis over time (basis, "exclude public holidays" yes or no, effective from and to, reason, who set it). Effective-dated; history is never overwritten, like contract rates. **A contract with no row stays on the company default, so every existing contract pays exactly as now.**
3. `PublicHoliday` (company, date, name) and `HolidayCalendarYear` (company, year, confirmed by, confirmed on). **I will not put holiday dates in the code:** some are announced by government each year, so the company enters them and **confirms the year**, the same discipline as statutory settings.

**The rule in the engine (pure, tested without a database):**
- **Calendar days:** divisor is the days in the month; every paid day counts. (As today, when the company rule is calendar.)
- **Working days:** divisor is the Monday-to-Friday days in the month, **minus the confirmed public holidays if the contract excludes them**. **Only paid days that fall on a working day count towards basic pay**, so a weekend or public-holiday day adds no basic pay; it is paid only through the existing overtime approval route. Leave and off days on a working day still count as paid. This keeps pay at or below one full gross.
- A client's invoice uses the same factor, so **what the client is billed follows what was agreed** (the engine bills from the same factor it pays from).

**Safety checks:**
- A contract that excludes public holidays cannot be paid for a month in a year whose holiday list is not confirmed: the run shows a blocking validation issue naming the contract.
- A person who moved between contracts with **different** bases in the same month is flagged for review rather than paid on a guess.

**Screens:** a "Paid days" section on the contract (set the basis and the effective date, see the history), and a Holidays page under Pay setup (enter the dates, confirm the year).

## 4. Order of work (tests first)

1. Pure engine tests with worked months: January (31) on calendar days; a 22-working-day month; a month with a public holiday excluded (21); a person who works every weekday and a Saturday (capped, the Saturday only as overtime); a leaver mid-month; a person absent two days; the existing contracts unchanged. **The golden payroll datasets must pass unchanged.**
2. Migration and service rules (who may set a basis, history, holiday calendar). 3. Assembly and the validation issues. 4. Screens. 5. Explain-back note with a worked example.

## 5. What I need from you before I start

1. **Is the working week Monday to Friday** (your 22 days)? Do any clients work Monday to Saturday?
2. **Public holidays:** do you agree the company enters the holiday dates each year and confirms them (rather than me putting dates in the code)?
3. **Who may change a contract's basis?** Because it changes pay, I recommend a second person approves it, as for personal pay rates. Agree?
4. **A person who moves between contracts with different bases mid-month:** flag for review (my recommendation), or use the basis of the contract they end the month on?
5. **Overtime on a public holiday or weekend** continues through the existing approved-overtime route and its rates: correct?

## 6. What this does not change

No tax, pension, NHF or other statutory rate or rule: they follow the pay amounts as before. No change for any contract until a basis is set on it. Unpaid leave is a separate decision.
