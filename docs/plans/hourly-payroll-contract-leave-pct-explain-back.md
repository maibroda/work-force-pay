# Explain-back note: hourly pay, H14, the contract's own leave percentage

On the founder's message of 2026-11-21 ("the leave percentage could be determined by the contract, but 2.5% could be used as default") and his answer that the contract's percentage lives **on the contract's rate** for a job role, effective-dated, blank = the company's percentage. This changes how leave pay for staff paid by the hour is worked out, so it is a pay change; it is **off in effect** until a percentage is entered (a blank contract rate and a company percentage of 0 pay nothing, as before).

## What it does, step by step

1. **A new optional box on the contract's agreed rate** (screen: Contracts > Agreed rates): "Leave pay % for staff paid by the hour", 0 to 100, at most two decimal places. **Blank** means "use the company's percentage" (the payroll rule). **0** means "no leave pay on this contract". It belongs to that rate row, so it is effective-dated like the rate: setting a new rate row starts blank again (the old value is **not** carried over; type it again if it still applies).
2. **Which percentage a site gets:** for each site (contract and place) a person worked in the month, the pay run looks up the contract rate for the person's job role **in force on the last day they worked at that site in the month**. If that row has a percentage (including 0), that is the percentage; if it is blank, or there is no rate, the company's percentage from the payroll rules is used.
3. **Everything else is as before:** the percentage is worked on the pay for the hours worked on or after the day the person completes the company's service period (12 months by the leave policy), added to the site's gross, split by the site's salary structure, taxed and counted for pension like the hours, stored with the payroll record (with the percentage actually used), and shown on the payslip as "Leave pay (5% of 10,000.00)". Late hours paid by a supplementary payroll get the same.
4. **One change to when it is worked out:** until now the percentage was only worked out when the company's percentage was above 0. Now it is always worked out per site, because a contract may set its own while the company's is 0.
5. **Stored:** one new optional column on the contract rate (`hourlyLeavePct`), reversible migration `20270104090000_contract_leave_pct` (the down script removes the column; the percentages entered are lost, pay lines already stored keep the percentage they used). Audited with the rate (`CONTRACT_RATE_SET`, ids and numbers only).

## Where each rule comes from

Your message of 2026-11-21 and your two answers (on the contract's rate; the figures are defaults for new settings only). **My assumption, to confirm:** if a person worked at one site in a month and the rate changed during the month, the percentage in force on the **last day worked at that site** applies to all of that site's hours that month (a rate change on 1 April therefore applies to April, and a change in the middle of a month applies to that month's hours at that site as a whole). If you want it day by day, that is a small further step.

## Worked example (the percentages are test figures, not recommendations)

Company percentage 10. A guard has 10 hours on Monday at 1,000 an hour at contract A (rate says 5) and 10 hours on Monday at contract B (rate blank): contract A gives 5% of 10,000 = **500.00**, contract B gives the company's 10% of 10,000 = **1,000.00**. Contract C's rate says 0: **nothing**. With the company's percentage at 0, A still pays 500.00 and B pays nothing.

## What could go wrong

- A rate row set again without retyping the percentage drops it back to "company" (stated on the form).
- The warning shown when annual leave is approved for an hourly person still quotes the company's percentage, not the contract's (wording only; no amount depends on it).
- A rate change in the middle of a month is applied to that month as a whole for that site (see the assumption).

## Which tests prove it

`tests/integration/hourly-contract-leave-pct.test.ts` (8): saving (blank, 0, 100, rejected -1 / 100.5 / 2.555, not carried to a new row, the rate book reads it, audited); 5 beats the company's 10; blank uses 10; 0 means none; two contracts in one month; effective-dated (March 5, April blank = 10); late hours by supplementary payroll; company 0 with a contract that sets its own. `tests/unit/hourly-leave-pay.test.ts` (2 new): a percentage per site and its 0 to 100 check.
