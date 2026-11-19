# Hourly-based payroll: assessment, architecture and open decisions

Written 2026-11-19 from the founder's request of that date (a "Configurable Hourly-Based Payroll" prompt). **Status: proposal only. Nothing is built, no migration exists, no rate or rule below is a decision until the founder approves it in writing.** Per the working method, this document is the first deliverable the request itself asks for (assessment, architecture, database design, business rules and open decisions, phased plan). The request's own governance line is kept: no pull request is merged without the founder's explicit "merge #N", and no approved decision is changed without a documented proposal.

Requirement IDs: the request's own section numbers (R1 repository assessment, R2 compensation types and rates, R3 hours and attendance, R4 public holidays, R5 calculation, R6 workflow, R7 payslips and reports, R8 integrity and audit, R9 compatibility, R10 tests, R11 delivery).

## 1. The request in my own words

Today WorkforcePay pays a **monthly gross** that is divided by days: a person is on the work register for each day (or on a personal monthly pay rate), and the pay run pays the share of the month they were present. The founder wants a second way to pay a person: **approved hours × an hourly rate that depends on whether the hour fell on a weekday, a weekend day or a public holiday**, for some employees, in the same company and the same pay month as monthly-paid staff, going through the same approval, locking, statutory deductions, payslip and reports. Rates must be data, not code, and can differ by client, contract, job role and person, with effective dates and history. An hour must be placed on the calendar day it actually fell on (a Friday 19:00 to Saturday 07:00 shift is five Friday hours and seven Saturday hours, not twelve of either).

## 2. What exists today (verified by reading the code)

| Area | What is there | Where |
| --- | --- | --- |
| How monthly pay is worked | The engine takes the person's days (`WorkDay[]`), finds each day's rate (`resolveRate`: a contract rate for the category, or the personal pay rate), and pays `monthly gross x paid days / basis days`. The gross is split into components (basic, housing, transport and so on) by a salary structure, which is where pensionable pay and the PAYE base come from. Everything is whole kobo, half up, once. | `src/lib/payroll/engine.ts`, `structure.ts`, `money-exact.ts` |
| Personal pay rate | `EmployeePayRate`: a monthly gross, effective-dated, proposed by one person and approved by another (`PayRateProposal`). The pay run picks the rate per DAY, so a mid-month change splits by day (proved in `mid-month-pay-rate.test.ts`). | `prisma/schema.prisma`, `rates.ts` |
| Contract rate | `ContractRate`: per contract and category, an agreed monthly rate billed to the client, a salary structure and an operative share. Monthly, per head. **No hourly field anywhere.** | schema |
| Work register | One row per employee per **date** (unique), with client, contract, beat, shift (`DAY`, `NIGHT`, `FULL`), attendance status, `hoursWorked`, `overtimeHours`, source, location-mismatch flag. **No clock-in or clock-out time. No approval status on the row.** When hours are not typed, a present or late day is saved as **12 hours** (`operations.ts`). A save over an existing day replaces it (audited). A locked period cannot be edited (`assertPeriodEditable`). | `operations.ts`, schema |
| Clocking | Does not exist. The module catalogue itself says "Work register, attendance and rosters exist; clocking does not." | `entitlements/catalogue.ts` |
| Overtime | A separate approved line (`Overtime`: hours, optional hourly rate, amount, approval status, approval reference), usually from a client schedule. `overtimePay(hours, rate)` and `overtimeHourlyRate(gross, days, hours, multiplier)` exist and are exact. Overtime is paid as an irregular earning. | `pay-inputs.ts`, `engine.ts` |
| Public holidays | `PublicHoliday`: a date and a name, **company-wide**, entered by the company each year and confirmed per year (`HolidayCalendarYear`). Used today only by the working-days paid-days basis. **No state or location, no effective-dating of the holiday itself** (a removed holiday is deleted; the audit log keeps the fact). | `holidays.ts`, schema |
| Paid-days basis | `ContractPayBasis` (calendar days or working days, public holidays excluded or not), proposed and approved by two people. | `paid-days.ts` |
| Payroll records | `PayrollRecord` per person per run with earnings lines; `PayrollAllocation` splits a person's pay across beats; payslips read the record. Attendance summary on the payslip is days and overtime hours. | schema, `payslips.ts`, `payslip.tsx` |
| Approval and lock | Period status runs OPEN, approved, locked; a locked period is corrected only by a supplementary run. Maker, checker and approver separation exists. | `payroll.ts` |
| Statutory | PAYE by state, pension, NHF, NSITF, ITF are effective-dated settings read by the engine. | `statutory.ts`, `paye.ts` |
| Feature switches | Per-company module switches (entitlements); a module can default to OFF. | `src/lib/entitlements/` |

## 3. Gaps against the request

1. **No hourly rate of any kind** (employee, contract, category, effective dates, history).
2. **No compensation type** on an employee.
3. **No clock-in and clock-out**, no per-shift record, no overlap check, no approval status on hours. Hours on the work register are typed or defaulted (12), neither of which may ever be paid as hourly pay.
4. **One work-register row per day** cannot hold two shifts in a day, and records a night shift against one date.
5. **Holidays have no state or location**, and no way to say "this holiday applies to these states".
6. **The engine has no hours-based path.** Gross comes only from `monthlyGross x days`. The split into basic, housing and transport (hence pensionable pay and PAYE) depends on a salary structure that is built for a monthly gross.
7. **Payslip and reports** show days and overtime, not weekday, weekend and holiday hours and amounts.
8. **Nothing records, for every pay line, the hours and rate it came from**, so a later rate change could not be proved not to alter history unless the breakdown is stored.

## 4. Proposed architecture (one engine, not two)

**Principle:** no parallel payroll engine. An hourly employee goes through the same run, the same statutory steps, the same approval and lock, and the same payslip. What changes is only **where their earned gross comes from**.

1. **A pure module for hours, `src/lib/payroll/hourly.ts`** (no database, no framework, like the rest of `src/lib/payroll`):
   - `splitShift(clockIn, clockOut, holidays)`: cuts a shift at every midnight (West Africa Time, which has no daylight saving) into calendar-day segments in whole minutes, each given a day class by `classifyDay(date, holidays)`.
   - `priceHours(segments, rates)`: minutes per class x the class rate, in exact arithmetic, **rounded half up to the kobo once per class line**, with `money-exact.ts` (no floats).
   - Returns a full breakdown: for each segment, the date, class, minutes, rate, amount.
2. **The engine takes an optional `hourly` input** and, for an hourly employee, uses the priced total as the earned gross for the month instead of `monthly gross x paid days / basis days`. The gross is split by a salary structure as today (see decision H8). Everything after that (pension, NHF, PAYE, deductions, net, employer costs, allocation to beats) is the existing code, unchanged. A monthly-paid employee takes the existing path exactly as now; a test proves the existing golden datasets are untouched.
3. **Hours come from a new per-shift record** (`TimeEntry`, below), not from the day-level work register. The work register stays the truth for **where and whether** a person was present (and keeps feeding reports and location checks); for an hourly employee the pay reads **approved time entries only**.
4. **Rates** live in a new effective-dated, approved, history-keeping table (`HourlyRate`), resolved by a precedence rule the founder chooses (H1).
5. **Holidays** get an optional scope by state (`PublicHolidayState`), so a holiday can be national or apply to named states; a work location's state (`Beat.state`) decides which apply.
6. **Behind a switch that defaults to OFF** (a new module key under the existing entitlements, rule 8). With it OFF nothing changes anywhere, and the new screens are hidden and refused on the server.
7. **Premiums are separate.** Overtime, night differential and minimum-hours rules are NOT part of the three rates and are NOT built until the founder decides (H4, H5, H7). The existing `Overtime` line stays as it is and still works for monthly-paid staff.

## 5. Database design (draft, no migration yet)

All new tables carry `organizationId`, are scoped on every query, and have cross-company isolation tests. Money columns are `Decimal(16,2)` and calculated in kobo. A migration needs the founder's "go" and a reversible `down.sql` round-tripped on a seeded copy.

| Change | Purpose |
| --- | --- |
| `Employee.compensationType` enum `MONTHLY` (default) or `HOURLY`, additive, default keeps every existing person as they are | R2 |
| `HourlyRate`: `scope` (EMPLOYEE, CONTRACT_CATEGORY, CATEGORY, or company default if H1 allows), `employeeId?`, `contractId?`, `categoryId?`, `weekdayRate`, `weekendRate`, `holidayRate` (each `Decimal(14,2)`), `effectiveFrom`, `effectiveTo?`, `reason`, status PENDING/APPROVED/REJECTED/CANCELLED, proposer and approver (a different person), decision note. Never edited: a change is a new row with an end date on the old one. | R2, R8 |
| `TimeEntry`: employee, client, contract, beat, `clockIn` and `clockOut` (timestamps, WAT), `breakMinutes?` (only if H5 says so), `status` (DRAFT, SUBMITTED, APPROVED, REJECTED), submitted by, approved by (a different person from the one who captured it), source, `supersededById?` for a correction. A missing clock-out stays DRAFT and **can never be paid**. An overlap with another entry of the same person is refused by the service and by a database constraint. | R3, R6 |
| `TimeEntrySegment` (the stored breakdown, written when the entry is approved): date, day class, minutes, state used to decide the holiday | R3, R8 |
| `PublicHolidayState`: holiday id, state code (no rows = national) | R4 |
| `HourlyPayLine` (the stored breakdown of a payroll record): record id, class, minutes, rate **as used**, amount, the entry ids it came from | R5, R8: history can never change when a rate later changes |
| `PayrollRecord` or the payslip lines carry weekday, weekend and holiday hours and amounts as ordinary earning lines with their own codes (so the existing payslip, GL mapping and reports see them) | R7 |

Audit entries (append-only, so they carry **ids, numbers, statuses and enums only**, never free text): `HOURLY_RATE_PROPOSE/APPROVE/REJECT/END`, `TIME_ENTRY_CAPTURE/SUBMIT/APPROVE/REJECT/CORRECT`, `HOLIDAY_STATE_SET`, `COMPENSATION_TYPE_CHANGE`. Rates in the audit are kept (a money trail, as for settlement amounts).

New permissions (draft): `hourlyrate.propose`, `hourlyrate.approve` (the payroll manager, never the proposer), `timeentry.capture` (supervisor, payroll officer), `timeentry.approve` (supervisor or payroll manager, never the capturer). The approval of hours and the approval of the pay run are two different steps by design.

## 6. Worked example (invented numbers, to show the rule, not a rate)

**ILLUSTRATIVE ONLY. These rates are made up for the example; the system will hold whatever rates the founder and the client agree.** Weekday N1,000 an hour, weekend N1,500, public holiday N2,000.
A shift from Friday 19:00 to Saturday 07:00 is 12 hours: **5 hours on Friday (19:00 to 24:00) and 7 hours on Saturday (00:00 to 07:00).**
- Saturday is an ordinary weekend: 5 x 1,000 + 7 x 1,500 = 5,000 + 10,500 = **N15,500**.
- Saturday is a public holiday and the holiday rate takes precedence (H3, option 1): 5 x 1,000 + 7 x 2,000 = 5,000 + 14,000 = **N19,000**.
- Friday is the public holiday and the shift is not cut at midnight (the "starting day" alternative, H2 option 2): 12 x 2,000 = N24,000. This is why H2 matters: the same shift pays N15,500, N19,000 or N24,000 depending on two rules.

## 7. Decisions the founder must make (nothing is assumed)

The seven in the request, with a recommended answer where I have one, plus the ones I found by reading the code. **Until a decision is approved, the matching piece is not built.**

| # | Question | Options | My recommendation |
| --- | --- | --- | --- |
| H1 | Where do hourly rates live, and which wins when several apply? | Employee only; contract/client; job role; a combination with a precedence | A combination, most specific first: employee, then contract and role, then role. The precedence order is yours to set. |
| H2 | A shift that crosses midnight | Allocate the actual hours to each calendar day; or the starting day | Actual hours (as the request recommends). |
| H3 | A holiday on a Saturday or Sunday | Holiday rate wins; weekend rate wins; the higher of the two | Holiday rate wins (the request's own wording says it takes precedence). |
| H4 | Overtime | A separate premium on top of the three rates; included in the rates; not applicable | Separate and configurable. Needs the overtime threshold (per day, week or month) and the multiplier from you. Not built until decided. |
| H5 | Unpaid breaks | Deduct approved breaks; all recorded hours payable; client-specific | Not decided by me. Client contracts differ, so likely per client. |
| H6 | Pay cycle for hourly staff | Monthly (the existing pay month); weekly; per client | Monthly. Weekly needs a new payroll calendar and is a separate piece. |
| H7 | Minimum guaranteed hours per shift or month | Not decided; yes; no | Not built until you answer. |
| H8 | **Which salary structure splits an hourly person's gross** into basic, housing and transport? This decides the pensionable base and the PAYE base, so it is a pay and tax matter. | A structure chosen on the hourly rate; the person's category structure; one structure for all hourly staff | Needs you. I will not choose a split. |
| H9 | **Who approves hours**, and can an approver also capture them? | Supervisor approves; payroll officer approves; both | Capture and approval by different people, always; who holds each is yours to say. |
| H10 | **Missing clock-out**: what happens? | Not payable until a supervisor completes it; a cap at an agreed length | Not payable until completed. No default hours are ever paid (the 12-hour default on the work register must never apply to an hourly person). |
| H11 | **Which state decides a holiday** for a person at a site | The work location's state; the person's state of residence | The work location's state (PAYE uses residence; the holiday is a property of where the work was). Confirm. |
| H12 | **PAYE on irregular monthly pay.** An hourly person's monthly gross varies. Does the existing monthly PAYE treatment apply unchanged? | Yes, same method; or another | I will not decide a tax method. If the existing treatment is wrong for variable pay, a tax adviser must say so. |
| H13 | **Minimum-wage check** for hourly staff | A warning when monthly hours x rate falls below a figure the company sets; none | A configurable warning only, with the figure supplied by you or your adviser. No figure is put in the code. |
| H14 | **Leave, sickness and absence for an hourly person**: are they paid for these? | Not paid; paid at the average; per policy | Needs you and the lawyer. |
| H15 | **Client billing**: do hourly clients get an hourly invoice? | Out of scope for now; build later | Out of scope for this piece (the request is about payroll cost). Reports will show payroll cost per client and contract. |
| H16 | **Cut-off for a time entry**: can an approved entry be changed after approval? | Never; by a correction entry with a reason, approved by a different person | A correction entry (the original is kept and marked superseded). |

### Answered by the founder on 2026-11-19

| # | Answer |
| --- | --- |
| H1 | **Combination, most specific first:** the employee's own rate wins, then the contract and job role, then the job role. Every level is effective-dated, kept as history and approved by a second person. |
| H2 | **Allocate the actual hours to each calendar day.** This is also stated in the request itself (section 3: do not classify a shift by its starting date only), so it is a requirement, not an open question. |
| H3 | **The public holiday rate wins** over the weekend rate when a holiday falls on a Saturday or Sunday. |
| H4 | **Overtime is a separate, configurable premium** on top of the three rates. Still not built: it needs the threshold (per day, week or month) and the multiplier from the founder, and it is phase 6. |
| H6 | **Monthly, in the existing pay month.** Weekly or per-client cycles are separate pieces if ever wanted. |

Still open: H5, H7 to H16 (H8 and H12 touch pay and tax and need the founder or an adviser; I will not choose them).

## 8. Business rules I am NOT inventing

The three rates, the precedence order, the overtime threshold and multiplier, the night differential, the minimum hours, the break rule, the minimum-wage figure and the split structure are all **data the founder or the client supplies**. The seed will carry obviously fictional demonstration values only, marked as such, never a real rate.

## 9. Compatibility and risks

- **Monthly staff unchanged.** The engine's monthly path is not touched; the golden datasets and existing tests must pass unchanged on every run, and a new test pins a mixed company (monthly and hourly in one period).
- **No double counting.** A person is either MONTHLY or HOURLY at a given date; changing the type is effective-dated, audited and refused inside a locked period. A person on a personal monthly pay rate who becomes hourly needs the old rate ended on the day before.
- **Critical-file change.** The engine, `payroll.ts`, the new `hourly.ts` and the services are pay and approval code. They are added to CODEOWNERS, built tests first, each with an explain-back note.
- **Performance.** Splitting and pricing is a small pure computation per entry. Payroll for 3,000 people must still finish within 10 minutes: a test with 3,000 hourly people and 30 entries each, to be written and run in CI, not only on a laptop.
- **Time zone.** Clock times are stored as WAT instants and cut at WAT midnight. A test pins the midnight cut and a month boundary (a shift crossing the last midnight of the month belongs half to each pay month).
- **Data entry burden.** There is no clocking device today. The first release lets a supervisor or officer type clock-in and clock-out; a device or mobile clocking is a later piece and not designed here.
- **Privacy.** Time entries are personal data: covered by the data copy (`compileEmployeeData`) and erasure (`anonymizeEmployee`) with tests, like every other personal record.
- **Not covered by this assessment:** the existing 12-hour default on the work register is a finding, not changed here.

## 10. Phased plan

Each phase is its own pull request, tests first, with an explain-back note, and stops for the founder's approval.

| Phase | What | Migration | Needs |
| --- | --- | --- | --- |
| 0 | This document and the decision-register row | none | Your answers to H1 to H16 |
| 1 | `hourly.ts`: split a shift at midnight, classify the day, price the hours, in exact arithmetic. Pure functions and tests only (weekday, weekend, holiday, midnight, holiday after midnight, partial shift, month boundary, rounding) | none | H2, H3 (the example above becomes the first tests) |
| 2 | Database: compensation type, `HourlyRate` with propose/approve, holiday states, behind the switch (OFF) | yes, additive, round-tripped | H1, H11 |
| 3 | Time entries: capture, submit, approve, correct; overlap and duplicate refusal; missing clock-out | yes | H5, H9, H10, H16 |
| 4 | Payroll integration: engine `hourly` input, stored `HourlyPayLine`, payslip and statutory, mixed-company test, historical reproduction test | maybe small | H8, H12, H14 |
| 5 | Reports: employee summary, client and contract cost, class earnings, approved versus unapproved hours, month comparison, budget versus actual | none | none |
| 6 | Premiums (overtime, night differential, minimum hours) as separate rules, OFF by default | yes | H4, H7 |

## 11. Tests this will need (R10), mapped to phases

Phase 1: weekday, weekend, holiday, midnight, shift into a holiday, partial shift, month boundary, rounding to the kobo once. Phase 2: effective-dated rate change, precedence, isolation between companies, a proposer cannot approve. Phase 3: missing clock-out, duplicate and overlapping entries, unapproved entry never enters a run, a correction keeps the original. Phase 4: mixed monthly and hourly in one run, adjustments and arrears, historical payroll unchanged after a later rate change, calculation traceable to entries and rates, golden datasets unchanged. Phase 5: reports add up to the payroll total without double counting.

## 12. Findings and suggestions (not built)

1. The work register defaults a present day to 12 hours when none is typed (`operations.ts`). Fine for monthly pay, which ignores it, but it must not feed hourly pay. Phase 3 reads time entries only.
2. A work-register save over an existing day replaces the row; the audit entry records the beat and status but not the hours.
3. A public holiday removed from the list is deleted; a historical holiday is kept only in the audit log. Phase 2 makes a holiday effective-dated only if the founder wants history on the calendar itself (R4 asks for it).
