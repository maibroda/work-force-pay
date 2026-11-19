# Explain-back note: hourly pay, phase 1 (the hours arithmetic)

Phase 1 of `hourly-payroll-assessment.md`, started on the founder's "go with phase 1" of 2026-11-19. Files: `src/lib/payroll/hourly.ts` (new) and `tests/unit/hourly.test.ts` (new, 37 tests). **No database change, no screen, and nothing in the pay run uses it yet**: it is the calculator on its own, so an hourly person cannot be paid by it until later phases connect it. The folder `src/lib/payroll/` is already in CODEOWNERS, so the new file needs the two owners' review.

**What it does, step by step**
1. **Takes a clock-in and a clock-out** and refuses it unless it ends after it starts and both are on a whole minute. Hours are counted in whole minutes; a time with seconds is refused, never rounded.
2. **Cuts the shift at every midnight in Nigeria** (West Africa Time, one hour ahead of UTC all year, no daylight saving). So the shift is a list of pieces, each inside one calendar day. A Friday 19:00 to Saturday 07:00 shift is two pieces: 5 hours of Friday and 7 hours of Saturday (the founder's rule H2).
3. **Gives each piece a class.** Monday to Friday is a weekday, Saturday and Sunday are a weekend, and a public holiday is a holiday **even when it falls on a weekend** (the founder's rule H3: the holiday rate wins). The list of holiday dates is handed in; this code does not decide which holidays apply to which state (that is a later phase, and your decision H11).
4. **Prices the hours.** For each class it adds up the minutes of all the pieces, multiplies by that class's hourly rate, divides by 60, and rounds half up to the kobo **once, on that class's line** (the shared rule of `money-exact.ts`). The total is exactly the sum of the lines. Each line keeps the rate it used, so that a later rate change can never alter a past line.
5. **A helper picks out the pieces that fall in a pay month**, so a shift over a month end is paid half in each month.

**Where each rule comes from.** H2 and H3 are your answers of 2026-11-19. Rounding half up once per line is the project's money rule (rule 2). Counting in whole minutes and the fixed one-hour offset are my reading of "hours worked" and of Nigerian time, stated here for you to confirm.

**Worked example** (invented rates: weekday 1,000, weekend 1,500, holiday 2,000 an hour, for illustration only). Shift Friday 19:00 to Saturday 07:00.
- Ordinary Saturday: 300 minutes of Friday (5 hours x 1,000 = 5,000) and 420 minutes of Saturday (7 hours x 1,500 = 10,500). Total **15,500**.
- Saturday a public holiday: 5 x 1,000 + 7 x 2,000 = 5,000 + 14,000. Total **19,000**.
- Rounding: one minute at 1,000 an hour is 16.666... naira, so 16.67. Two one-minute weekend pieces at 0.90 an hour are 2 minutes x 0.90 / 60 = 3 kobo; rounded piece by piece they would be 2 + 2 = 4 kobo, which is why the minutes are added up first.

**What could go wrong, and what is NOT covered**
- **It is not wired in.** No pay run, payslip or screen calls it. Until phases 2 to 4, hourly pay does not exist for anyone.
- **Which holidays apply** is not decided here: the caller must pass the right dates for the place of work. A wrong list gives wrong classes. (H11, phase 2.)
- **No limit on shift length** is built, because none was decided: a 40-hour "shift" is cut into days and priced like any other. The approval of time entries (phase 3) is where an unreasonable shift is caught by a person.
- **A missing rate** must be refused by whoever looks the rate up (phase 2). Here a rate of zero means a class that is deliberately unpaid, and negative and part-of-a-kobo rates are refused.
- **Not built, by design:** overtime, night differential, minimum hours, breaks (decisions H4 to H7), which rate applies to whom (H1, phase 2), and the salary structure that splits the gross into basic, housing and transport (H8, a pay and tax matter I will not choose).
- **Calendar and time zone** are tested with fixed dates (2026-07-31 is a Friday). A month end is tested both ways.

**Tests that prove it** (`tests/unit/hourly.test.ts`, 37): weekday, weekend and holiday classes (including a holiday on a Saturday and on a Sunday); Friday-to-Saturday, Saturday-to-Sunday and Sunday-to-Monday cuts; a shift into a holiday and out of one; the cut is at Nigerian midnight and not UTC midnight; a shift ending or starting exactly at midnight; partial minutes; a shift over three days; the month-end split; the 15,500 and 19,000 examples; half-up rounding and the tie case; rounding once per class; the total equals the sum of the lines; refusals (no end, no minutes, seconds, bad dates, negative and part-kobo rates); a fixed sequence of 500 shifts proving that pieces join end to end, never cross midnight, add up to the shift and agree with `classifyDay`; and a scan that the file uses no floating-point rounding. I confirmed the tests have teeth: with the holiday rule reversed and the cut moved to UTC midnight, 13 of the 37 failed.
