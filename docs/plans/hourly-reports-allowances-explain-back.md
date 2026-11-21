# Explain-back note: leave, sick and holiday pay in the hourly reports

On the founder's "CONTINUE" of 2026-11-21 after `hourly-reports-allowances-plan.md`: I took **option A** (read the stored payroll lines) with the plan's defaults. **Reports only: no pay figure, payroll run, payslip or setting changes, and no migration.** If you wanted option B or C, or other defaults, say so before this is merged.

## What it does, step by step

1. **Three cost reports gain four columns** (by employee, by client and contract, month by month): "Leave pay (payroll)", "Sick pay (payroll)", "Holiday pay not worked (payroll)" and "Total with extra pay". The month-by-month report also shows the **state of that month's payroll** (Calculated, Waiting for approval, Approved, Locked, Paid, or Not calculated). The hours-only status report is unchanged.
2. **Where the figures come from:** the lines the pay run stored (`HourlyAllowanceLine`), **not** a second calculation. For each whole payroll month the report's dates touch, it reads every payroll run of that month that is **not superseded** (a supplementary run counts too; a recalculation replaced its run's lines, so nothing is counted twice). Amounts are added in whole kobo through the shared money utility, once.
3. **"Total cost" keeps its meaning** (approved hours at approved rates, indicative). **"Total with extra pay"** = that plus the three extra pays. The by-employee and by-client totals agree.
4. **A month with no calculated payroll** shows 0 for the three pays, and the month-by-month report names it in its description ("Not yet calculated ... 2051-04"). A draft or calculated payroll counts (so a manager sees it as soon as it is calculated); the Payroll column says which state it is in.
5. **Whole months:** extra pay is a monthly payroll amount, so a report for 25-31 March shows March's extra pay in full, even if the hours in those days are few or none (a person with only a sick day then still has a row). The report description says so.
6. **Same access as before:** the three cost reports need the payroll right; everything is for the caller's company only.
7. **A wording fix:** the reports said "the pay run does not read hours yet", which has been untrue since the pay run was built; it now says only "not payroll".

## Where each rule comes from

The plan you approved by "CONTINUE" (option A and its defaults: the latest calculated run counts, "Total cost" unchanged). The leave, sick and holiday rules themselves are unchanged: this only reads what they stored.

## Worked example (invented figures)

Ten hours on a Monday at 1,000 = **10,000** (hours cost). The pay run adds 10% leave pay **1,000**; HR approved a paid sick day, **3,000**, and a paid holiday not worked, **2,000**, all stored on March's payroll. The March report shows: hours cost 10,000, leave pay 1,000, sick pay 3,000, holiday pay 2,000, **total with extra pay 16,000**. April has approved hours but no payroll yet: the three pays show 0, the Payroll column says "Not calculated", and the description names April.

## What could go wrong

- The extra pays are for **whole payroll months**, while the hours follow the exact dates; a part-month report mixes the two (stated in the description).
- If two runs of the same month were ever both live (the pay run prevents it), their lines would be added; the superseded one is ignored.
- A payroll that is only a **draft** is counted and can still change; the Payroll column shows that.

## Which tests prove it

`tests/integration/hourly-reports-allowances.test.ts` (5): by employee (leave from a real pay run, stored sick and holiday lines, total of both, whole-month behaviour); by client and contract (total agrees with by employee); month by month (state, 0 and the named uncalculated month); a supplementary payroll counted once and a repeated report unchanged; a superseded run ignored, and another company sees none of it. `tests/unit/hourly-allowance-report.test.ts` (5): the totals in whole kobo and the refusal of fractional kobo. The existing hourly report tests (29) still pass.
