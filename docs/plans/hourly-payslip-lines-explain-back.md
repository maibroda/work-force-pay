# Explain-back note: the payslip PDF no longer hides hourly lines

A follow-up from my list of known limitations after H14 (hourly leave, sickness and holidays). **Layout only: no pay figure, line, total, rule or setting changes, and no migration.** If you wanted a different design (for example one summary line per site instead of more pages), say so before this is merged.

## What was wrong

The payslip PDF of a person paid by the hour listed at most **9 hours-and-pay lines** and then said "... and N more line(s), included in the total". With leave pay, sick pay and holiday pay now on that table, and a person working at several sites, a payslip could hide pay lines even though their amounts were in the total. A payslip should show what it adds up. The same cut-off hid work locations after the eighth.

## What it does, step by step

1. **Every line is drawn.** The hours-and-pay lines are drawn from the top of the section until the next line would reach the **footer** of the page; the footer is never drawn over.
2. **They carry on to a second (third...) page** when they do not fit, under the same column headings and a heading "HOURS WORKED AND PAY (continued)". The **totals line is drawn once, after the last line.** The heading, the first line and the totals are kept together so a heading is never left alone at the bottom.
3. **The footer** (prepared by, generated on, confidential) is on **every page**.
4. **Work locations, the attendance line and the notes** follow the same rule: all are drawn, on a new page if needed (the old limit of eight locations is gone).
5. **A payslip that fits on one page is drawn exactly as before** (a monthly payslip is unchanged; the PDF of several payslips still starts each on a new page).
6. The on-screen payslip already showed every line; only the PDF changed.

## Where each rule comes from

My own list of known limitations after H14, stated in my reports (the PDF "shows at most 9 hourly lines"). No payroll rule is involved.

## Worked example (invented)

A guard worked at 6 sites with weekday, weekend and holiday hours, plus leave pay at each: about 24 lines. Before: 9 lines were drawn and "... and 15 more line(s), included in the total". Now: the lines that fit on page 1 are drawn, the rest continue on page 2 under "HOURS WORKED AND PAY (continued)", and the total line closes the table once.

## What could go wrong

- A payslip is now sometimes **two pages**. Anything that assumed one page per payslip (printing on one sheet) will see an extra sheet only for people with very many lines.
- The page break is decided by the space left, so a line that just fits is drawn on page 1 and the next is on page 2.

## Which tests prove it

`tests/unit/payslip-pdf.test.ts` (4 new): all 14 lines are drawn and no "more line(s)" text; 80 lines use two or more pages, each line appears exactly once and in order, a "continued" heading starts the next page, the totals appear once at the end, the footer is on every page; no line is drawn over the footer; a payslip with no hourly lines is still one page and several payslips start on new pages. The existing payslip tests (unit and integration) still pass.
