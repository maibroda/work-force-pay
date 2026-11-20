# Explain-back note: hourly pay, late hours (NHF and the overpayment amount)

Two small changes to phase 4c-1 (late hours by supplementary payroll, #250), on the founder's answers of 2026-11-20: **(1) NHF is deducted from late hourly pay for people who chose it; (2) the overpayment finding also shows a naira amount at the current rate.** No migration. Files: `src/server/services/payroll.ts` (critical), `src/server/services/hourly-payroll.ts` (critical), `src/lib/payroll/hourly-earnings.ts`, `src/lib/payroll/hourly-minimum.ts` (one function made public).

## What it does, step by step

1. **NHF on late hourly pay.** In a supplementary payroll, a person paid by the hour who has chosen to contribute to the voluntary NHF now has NHF taken from their late pay as its own deduction line, exactly as the regular payroll does: the payroll rule's rate (2.5% as shipped) of the **Basic part** of that late pay. A person who has not chosen it has none. It reduces net pay. This applies only to the hourly part of a supplementary payroll; arrears, overtime and other adjustments are unchanged, as before.
2. **The amount on the overpayment finding.** When a correction after the lock means a person was paid for more hours than they worked, the blocking finding still names the hours, day, site and kind of day, and now adds "That is about NGN 2,000.00 at the rate in force that day": the overpaid minutes times the approved hourly rate in force on that day for that kind of day, in whole kobo, rounded half up once. If no approved rate applies, the amount is left out (never shown as zero). The finding is still only a finding: no negative pay is made and the deduction is entered by a person.

## Where each rule comes from

Both are the founder's answers of 2026-11-20. The NHF rate and who contributes are the existing payroll rule and employee setting (voluntary, 2.5% of Basic as shipped, the tax adviser confirms it); nothing new is hard-coded.

## Worked example (invented rates)

A guard who chose NHF works 12 hours on a weekday after the payroll is locked (12,000 gross at 1,000 an hour). The structure's Basic part is 10% of it: 1,200. The supplementary payroll takes 2.5% of 1,200 = 30.00 as NHF, besides pension and the extra PAYE. A colleague who did not choose NHF has none. Separately, a correction says a guard worked 6 hours, not 8, on a weekday: the finding says 2 hours were overpaid, "about NGN 2,000.00 at the rate in force that day".

## What could go wrong, and a question for the founder

- **PAYE relief on the late pay's own pension and NHF is not applied.** The supplementary payroll works the extra PAYE as the tax on (the locked payroll's taxable pay plus the late pay) less the tax on the locked payroll's, **both using the locked payroll's pension and basic for the reliefs**. That is how arrears and overtime have always been handled in a supplementary payroll, and the late hourly pay follows it. It means the pension taken on the late pay (and now the NHF) does not reduce the tax on it, so PAYE on late pay can be slightly higher than a regular payroll would have charged. **Should the supplementary payroll relieve the pension and NHF taken on the supplementary pay itself?** That would change arrears and overtime too, so I have not done it without your word.
- The amount on the finding is the rate **in force on that day**, not today's rate, and is only a guide for the deduction: a person still enters the deduction.
- A person whose rate changed after the lock is priced at the rate in force on the day worked, as the pay is.

## Tests that prove it

`tests/integration/hourly-late-payroll.test.ts`: a person who chose NHF has an NHF deduction on their late pay equal to 2.5% of the Basic line, net pay is earnings less pension, PAYE and NHF, and a person who did not choose it has none; the overpayment finding names "2,000.00" for 2 hours at 1,000. `tests/unit/hourly-earnings.test.ts`: `valueOfMinutes` values minutes at the rate of the kind of day to the kobo, and gives nothing (not zero) when no rate applies. Both failed before the change.
