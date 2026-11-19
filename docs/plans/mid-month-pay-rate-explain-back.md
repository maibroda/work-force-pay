# Explain-back note: a pay rate that starts in the middle of a pay month

Decided by the founder on 2026-11-19 (item S4 of `internal-selection-plan.md`): for a promotion that takes effect mid-month, pay **the old rate up to the day before the change and the new rate from the change date**. Test: `tests/integration/mid-month-pay-rate.test.ts` (2). **No pay code was changed**: the test was written first to find out whether payroll already does this, and it does.

**What the code does today, step by step**
1. A person on a personal pay rate (office staff, supervisors, anyone with no work register) has one pay rate row per period of time, each with a start date and an end date. When HR enters a new rate, the system closes the old one the day before the new one starts (`applyPayRate`, `src/server/services/pay-rates.ts`).
2. When payroll runs, it goes through each day the person is paid for and looks up the rate in force on **that day** (`employeePayRate` and `resolve` in `src/server/services/rates.ts`). So the days before the change use the old rate and the days from the change date use the new one.
3. The month's earned gross is the total of those days, divided over the company's days in the month (the company's paid-days rule). Each earnings line is rounded to the kobo.

**Worked example (April 2036, 30 days).** ₦300,000 a month, promoted to ₦360,000 from 16 April. 15 days at ₦300,000 / 30 = ₦10,000 is ₦150,000; 15 days at ₦360,000 / 30 = ₦12,000 is ₦180,000. Earned gross **₦330,000**. Promoted on 30 April: 29 x ₦10,000 + 1 x ₦12,000 = **₦302,000**. New rate from 1 April: **₦360,000**. No change: **₦300,000**. In a 31-day month (May 2036), promoted on 16 May: (15 x 300,000 + 16 x 360,000) / 31 = **₦330,967.74**.

**What the test proves.** All five figures above come out of a real payroll run. The old rate is closed the day before, the new one starts on the change date, and the month splits by days.

**What it does NOT prove, and what could go wrong**
- The 31-day case is proved on the company's **calendar-days** rule (the demo company's seeded rule). A company on the **fixed 30-day** rule, or a client contract with its own paid-days basis (working days), is **not covered**: I did not test them and would not assume the split.
- A person **on a client contract rate** (paid from the work register, not a personal rate) was not tested; this is the personal-rate path only.
- **The promotion does not create the new pay rate.** Approving a promotion changes the role; HR must still enter the new pay with the same start date. If HR enters it late or with a different date, the split follows the date HR typed. The existing digest flags an approved promotion not applied after 14 days. Whether the promotion should create the pay rate itself (as a proposal a second person approves) is a **separate decision for you**, not built.
- A pay rate entered AFTER that month's payroll was approved: I did not test what happens, so I make no claim about it.
