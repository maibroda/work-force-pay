# Plan: leave pay, sick pay and holiday pay in the hourly reports

For the founder to read and say "go" to. **Nothing here is built.** Written 2026-11-21, after #263 and #264 merged.

## 1. The gap

The four hourly reports (by employee, by client and contract, month by month, status) are built from **approved hours x approved hourly rates**, and say so: "the cost is indicative, not payroll". The three extra pays for staff paid by the hour (leave pay as a percentage, sick pay, holiday pay not worked) are **only worked out inside a payroll run** and stored as lines on it (`HourlyAllowanceLine`: kind, base, percentage, days, amount). So today a report of "what hourly staff cost us at this client" is **short by exactly those three pays**, and a payroll officer comparing a report with a payroll sees a difference with no explanation.

## 2. The decision I need from you

**Where should the report get these three pays from?** The hours are known as soon as they are approved; these pays exist only after a payroll run is calculated.

| Option | What it means | Good | Not so good |
|---|---|---|---|
| **A. Payroll-based (my recommendation)** | New columns "Leave pay", "Sick pay", "Holiday pay" and "Total with extra pay", taken from the **stored payroll lines** of the runs in the date range (latest calculated run for each person and month; supplementary runs included, nothing counted twice). A month with no calculated payroll shows 0 and a note "not yet calculated". | Exact: the figures are the ones the payroll used, in whole kobo, with the percentage and days stored then. No second calculation to keep in step with the pay engine. | Empty until the month's payroll is calculated; the existing hours-based columns stay indicative, so one report mixes an indicative part and a payroll part (labelled apart). |
| **B. Estimated** | Work out leave pay (percentage x eligible hours), sick pay and holiday pay again inside the report | Available before payroll | A second implementation of pay rules, which my rules forbid; two sources that can disagree. **Not recommended.** |
| **C. Leave as is** | Reports stay hours-only; the three pays are seen on payrolls and payslips | Nothing to build | The cost-by-client gap stays. |

## 3. What I would build under A (one pull request, no migration)

1. A small pure function that totals stored allowance lines by kind, month, employee and contract (whole kobo, one shared sum), tested first.
2. The three cost reports gain the four columns (by employee, by client and contract, month by month); the status report (hours only, no money) is unchanged. The cost reports already need the payroll right; so do the new columns.
3. "Not yet calculated" is shown for a month with no calculated run. A run that is a draft or superseded by a recalculation is read as the latest calculation; a locked month is final.
4. Tests: sums equal the payroll records' own figures; a supplementary run's allowances are included once; a recalculation replaces rather than adds; another company's data never appears; a person with none shows 0.
5. Docs: explain-back note, release notes, the report descriptions.

## 4. Questions for you (with my default if you say "your choice")

1. **Option A, B or C?** Default: A.
2. **Which payroll state counts?** Default: the latest **calculated** run of each month (draft, approved or locked), so a manager sees it as soon as payroll is calculated, with a column or note saying whether the month is still a draft. Alternative: only approved or locked runs.
3. **Does "Total cost" change meaning?** Default: no. "Total cost" stays the indicative hours-based figure, and the new "Total with extra pay" is separate, so existing exports and anyone's habits do not shift.

## 5. Not in this plan

Budget against actual (no budget in the application), hourly client billing (H15), overtime and night premiums (H4).
