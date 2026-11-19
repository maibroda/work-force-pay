# Paying some employees by the hour: questions for the tax adviser

For the founder to give to the company's tax adviser. 2026-11-20. WorkforcePay can already record hourly rates, shifts and approved hours, and report on them, but **it does not yet pay anyone by the hour**: the pay run still pays every employee as it always has. Before it does, three points are for the adviser. The system will do what the adviser says; **it will not invent a tax or pension rule**. Every rate, band and relief in the system is an effective-dated setting that the company enters and verifies, never fixed in the program.

## What the system does today for a monthly-paid employee (the facts the questions rest on)

1. **The month's gross is divided into parts** (Basic, Housing, Transport, Entertainment, Meal, Utility, Leave, Medical, Clothing) by a **salary structure**: a list of percentages that must total 100. Each part is marked **taxable** and **pensionable**. The structure the company has loaded decides which share of the gross is pensionable. In the demonstration data, Basic 10%, Housing 14% and Transport 15% are pensionable (39% of the gross) and every part is taxable.
2. **Pension** (employee and employer, at the rates in the company's settings) is worked on the pensionable parts. **NHF** (voluntary, at the company's rate) is worked on Basic.
3. **PAYE** is worked each month like this: the month's regular taxable pay is **multiplied by 12** to give an annual figure; the company's reliefs are taken off; the tax bands are applied; and the month's PAYE is **one twelfth** of the annual tax. Overtime, arrears and other one-off amounts are taxed separately, at the marginal rate, on top. A salaried person paid for only part of a month is taxed the same way on the smaller month. **No year-end reconciliation was found.**
4. **Employer costs.** ITF and NSITF are worked as a percentage of the person's gross. Other employer costs (insurance, uniform and kits, recruitment and training, leave reliever, outsourcing leave allowance) are worked from the client's agreed monthly rate for the person.

For an hourly person, the month's gross would be **approved hours times the agreed weekday, weekend and public holiday hourly rates**. Everything else above would then apply to that gross.

## Question 1: how should an hourly person's gross be divided into parts (pensionable and taxable)?

This decides the **pension and NHF base** and the **taxable parts**.

| Option | Pensionable share, in the demonstration structure |
| --- | --- |
| A. Use the same structure as a monthly person on the same contract or job role | 39% of the gross |
| B. A separate structure made for hourly staff, with percentages the adviser sets | whatever the adviser sets |
| C. All hourly pay as one line that is both taxable and pensionable | 100% of the gross |

**Please tell us:** which option, and, for B, the parts, their percentages, and which are taxable and which pensionable. If the law or the pension rules treat hourly earnings differently from a monthly package, please say how.

## Question 2: how should PAYE treat pay that varies from month to month?

Because the system multiplies a month's regular taxable pay by 12, the **annual figure it uses depends on that one month's hours**. With invented figures at N1,000 an hour: a month of 200 hours is N200,000 and is treated as an annual N2,400,000; a month of 80 hours is N80,000 and is treated as an annual N960,000. The same person's PAYE can therefore differ more, month to month, than a level monthly salary would.

| Option | What it means |
| --- | --- |
| A. The same method as monthly staff | Each month's earnings are treated as regular pay (above). Nothing new is needed. |
| B. Treat each month's hourly earnings as one-off income | The program already has this path (used for overtime and arrears): tax at the marginal rate on top of any regular pay. |
| C. A running year-to-date method | Tax each month on the cumulative position. Not built; a larger piece of work. |

**Please tell us:** which option is right for hourly workers, and whether a year-end reconciliation is required (none exists today).

## Question 3: employer costs for hourly staff

Without hourly billing to clients (decided out of scope for now), there is no client monthly rate to work the second group of employer costs from, so they would be **not applicable** for hourly staff. ITF and NSITF, worked as a percentage of the person's gross, would **still apply**.

**Please tell us:** whether that is right for ITF and NSITF (the statutory contributions) on hourly pay, and whether any other employer contribution applies to hourly workers that the system does not work out today.

## Two smaller points for the adviser or the lawyer

- **Minimum pay warning.** The system can warn (never block) when a person's monthly hours times their rate fall below a figure the company enters. What is the right figure, and is the test monthly? (No figure will be put in the program.)
- **Leave, sickness and public holidays for hourly workers.** Today an approved paid leave day counts as a paid day for a monthly person, and approved unpaid leave does not. Whether and how an hourly worker is paid for leave or sickness is a policy and legal question; until it is answered, an hourly worker is paid for **approved hours only**.

## Please return

| # | Answer |
| --- | --- |
| Q1 | Option, and if B the parts and percentages |
| Q2 | Option, and whether a year-end reconciliation is required |
| Q3 | ITF and NSITF on hourly pay; any other employer contribution |
| Minimum pay | Figure and the test |
| Leave and sickness | Policy |

The founder records the answers in the project's decision register; the program is then changed to follow them, tests first, with an explanation of each change.
