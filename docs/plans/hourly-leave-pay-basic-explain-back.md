# Explain-back note: leave pay on the Basic part of the pay

On the founder's confirmed decisions (the brief of 2026-11-21: leave pay 2.5% "calculated on basic salary") and his answer to my question about staff paid by the hour: **the percentage is taken of the Basic part of the hourly pay.** This changes how leave pay is worked out, so it is a pay change. **Status: engineering done; NOT production-ready: the legal and payroll-tax review of the 2.5% on the Basic salary, its tax and pension treatment, and the 12-month waiting period is outstanding** (see "Legal and policy dependencies" below). The 2.5% and the Basic basis are the founder's company policy, not statutory requirements, until that review confirms otherwise.

## What it does, step by step

1. **A new setting on each payroll rule version:** "What the leave pay percentage is taken of": **the Basic part of the pay** (BASIC) or **all the pay for the hours worked** (ALL_PAY, how the first build worked). It is effective-dated and versioned with the rule, changes are audited with who, when, old and new value (the existing payroll rule audit entry), and a new company copies the bureau's master rule as for every other rule setting.
2. **Defaults for NEW versions only.** A rule version created without a choice starts on **BASIC** (with the 2.5% default from the earlier change). **Every existing rule version is set to ALL_PAY by the migration**, and so is the demonstration company's rule, so **no past or open payroll changes** and no existing company-specific setting is overwritten. To move a company to the Basic basis, create a new rule version from the date you choose.
3. **How the Basic part is worked out:** for each site a person worked in the month, the eligible pay (the hours worked on or after the day the 12-month wait ended, each line rounded to the kobo, as before) is divided by that site's **salary structure** exactly as the payroll does for the hours; the **Basic component** of that split is the base. **Leave pay = the percentage x that Basic part, rounded half up to the kobo** (the Basic part is rounded once as its own line, then the leave pay once).
4. **The percentage** is still the company's, or the contract rate's own where set (blank = the company's).
5. **No Basic component, no guess.** If a site's structure has no active Basic component, no leave pay is paid on those hours, the hours themselves are paid, and **one blocking (critical) finding** names the person, the site and the structure. It is not replaced by gross or by the client's agreed rate.
6. **The calculation is kept for audit:** each stored leave line now holds the **base (the Basic part), the percentage, the amount and the basis** (BASIC; empty for a line made on the old basis). The payslip shows it as "Leave pay (2.5% of Basic 400.00)"; a line from the old basis reads as before. The pay it came from can be seen on the person's hours lines.
7. **The leave pay is added to the site's gross and split by the structure like the hours** (unchanged: taxed and counted for pension as part of earnings, **a treatment still to be confirmed by the adviser**).
8. **Wording:** the warning when HR approves annual leave for an hourly person now says "their leave pay is the X% worked out on the hours they work".

## Worked example (invented figures)

A guard works 10 hours at 1,000 = **10,000.00** of pay at a site whose structure gives Basic 40%. Basic part = **4,000.00**; at 2.5%, leave pay = **100.00**. (On the old all-pay basis the same 2.5% would have been 250.00.) With a structure that gives Basic 10%, the Basic part is 1,000.00 and the leave pay **25.00**. A structure with no Basic component: no leave pay, a critical finding.

## What could go wrong

- **The leave pay is much smaller than on the old basis** whenever Basic is a small share of the gross (as in the standard structure, 10%). That follows from the decision; check the structures' Basic share with the adviser.
- A company whose structure has no Basic component gets the finding until one is added.
- Moving a company onto the new basis is a deliberate act (a new rule version); nothing moves by itself.

## Legal and policy dependencies (outstanding, reported separately from the engineering)

Before production use: adviser review of the 2.5% leave-pay rate and the use of the Basic salary as its base; the tax and pension treatment of leave pay; and the 12-month waiting period. Record the reviewer, date, approved wording and amendments; a conflict goes to the founder before any change.

## Which tests prove it

`tests/unit/hourly-leave-pay.test.ts` (7 new): the Basic part at 10% and 2.5%, only eligible minutes, rounding once per line, a structure with Basic 40%, a structure with no Basic (no pay and the finding list), the all-pay basis unchanged. `tests/integration/hourly-leave-basic.test.ts` (6): the pay run on BASIC (base 1,000, 10%, 100, basis stored, payslip says "of Basic"); a version on ALL_PAY unchanged; no Basic component (hours paid, no leave, critical finding); late hours in a supplementary payroll; the setting (default BASIC for a new version, ALL_PAY choosable, anything else refused, effective dates, audited, copied to a new company); the demo rule and an older rule row keep ALL_PAY/BASIC as stated. The existing leave, contract-percentage, report and payslip tests still pass because they run on the old basis.

## Migrations and rollback

`20270106090000_leave_pay_basis` (the enum and the rule column; every existing row ALL_PAY, then the default for new rows becomes BASIC) and `20270106100000_leave_basis_on_line` (a nullable note on each stored leave line). Both have a `down.sql`, round-tripped down and up on a throwaway database. Rolling back loses only the setting and the notes: a rule version then works on all pay again.
