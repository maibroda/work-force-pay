# Legal and payroll-tax review: the hourly pay policies (register and adviser pack)

Opened 2026-11-23, from item 5 of the founder's confirmed brief. **Status of every review below: OUTSTANDING. Nothing here has been reviewed by a lawyer or a payroll-tax adviser.**

## 1. What this document is, and what it is not

- The founder approved business values (5 paid sick days, leave pay of 2.5%, averaging on gross earnings and so on). **Those approvals are company policy. They are not legal confirmation** that the policies comply with Nigerian employment, pension or tax law, and **nobody may describe them as statutory requirements** until a review below says so.
- Before **production activation** of any affected policy, the review in section 4 must be **recorded here**: the reviewer, the date, the approved policy wording, and any required amendments. If a review finds a conflict, the item **stops and goes to the founder** for a decision before the approved configuration is changed or the rule is switched on.
- **Production activation** means: a real company has the rule version (a leave pay percentage above 0, paid sick days above 0, the gross-earnings averaging method, the Basic basis for leave pay, a recovery of an overpayment) in force for a payroll that is paid. Demonstration data and tests are not production.
- This register holds no personal data: the examples are invented.

## 2. The policies, exactly as built (what the adviser is asked to review)

Each row says what the code does today, where it is configured, and what changes if the adviser amends it. All amounts are whole kobo, rounded half up once at each line. Every rule is **effective-dated and versioned**, so an amendment is a new version from a date; **no past payroll is rewritten**.

| # | Policy (founder's approved value) | How it works today | Configured in | If amended |
|---|---|---|---|---|
| **P1** | **Paid sick days: 5 a year** | Staff paid by the hour only. A spell of sickness needs the employee's medical certificate (a document in the medical category) and **HR approval by someone other than who recorded it and other than the employee**. The days are paid for the **first 5 working days of the leave year, in date order** (same leave year as annual leave); days beyond are not paid and a warning names them. Only a **usual day** (a day of the week they worked in the averaging period) is paid. The record holds dates, working days and the certificate's id: **never a diagnosis**. An approved spell can be cancelled by HR with a reason; days already paid by a final payroll raise a finding for Payroll, never negative pay. | Leave policy: `sickDaysPerYear` (company, versioned in the policy) | A setting change; a different entitlement basis (for example a calendar year) would be a small code change |
| **P2** | **Leave pay: 2.5%, calculated on basic salary** | Staff paid by the hour only. A percentage of the **Basic part of the hourly pay** (the Basic component of the site's salary structure split of the eligible pay), added to the person's gross like the hours (PAYE and pension as for hours). A contract's rate may set its own percentage; blank uses the company's. Not added on sick or holiday days (no hours are worked). **A rule version made before the Basic decision keeps "all pay for hours worked"**; a new version defaults to the Basic part. A structure with no Basic component pays no leave pay on those hours and raises a blocking finding. | Payroll rule version: `hourlyLeavePct` (2.5 default for new versions), `hourlyLeaveBasis`; the contract rate's own percentage | A new rule version; the base is a setting |
| **P3** | **Three-month averaging on gross earnings** | A paid sick day and a paid public holiday not worked are paid at the **average daily gross earnings**: the gross pay for the approved hours of the **3 months before** the spell or the holiday (each shift at the approved rate of its own day and kind of day), divided by the days worked. **Leave pay, sick pay and holiday pay are never in it.** Weekday, weekend and public-holiday hours all count by default (switchable). A new starter is averaged over the days they have; days not worked do not dilute it; hours with no approved rate are left out with a warning; no earnings means nothing is paid and a blocking finding says so. The calculation is kept on each stored line. | Payroll rule version: `hourlyAverageBasis`, `hourlyAverageMonths` (3), the three kinds-of-day switches | A new rule version |
| **P4** | **12-month waiting period** | Annual leave, paid sick days and paid public holidays not worked, and leave pay, are due only **after 12 months' service** (the leave policy's months), the same wait as monthly staff. | Leave policy: `eligibilityMonths` | A setting change |
| **P5** | **Tax and pension treatment** | Leave pay, sick pay, holiday pay and pay from a supplementary payroll are **part of gross**: taxed through PAYE and counted for pension like the hours, split by the site's salary structure. **Open question for the adviser:** on a supplementary payroll, the pension and NHF taken from the supplementary pay itself are not (yet) treated as reliefs against that pay's own PAYE. | Pay engine and the statutory rules (tax bands, pension, NHF are effective-dated settings the adviser verifies) | Possibly a code change to the PAYE step; the statutory settings are data |
| **P6** | **Late-approved holiday shifts and recovery of an overpayment** (plan: `hourly-holiday-adjustment-plan.md`) | Built: the record and its review (a second person, never the shift's approver); **the positive net difference is paid once, as an extra pay line (part of gross), by the earliest open payroll after the one that paid the day, and the supplementary payroll no longer pays that late shift while the adjustment stands (pieces B and D; explain-back `hourly-holiday-adjustment-bd-explain-back.md`)**. **Not built yet:** recovering an overpayment from pay **within the existing 33.33% cap, the rest carried forward** (a negative difference only raises a finding). | Payroll rule: `maxDeductionPctOfGross` (33.33) | Recovery must not be switched on until this item is reviewed |
| **P7** | **Sensitive data in sick leave** | HR (and the person) see spells; a supervisor does not. Certificates sit in the existing sensitive document store (access limited and audited). The audit log holds ids and numbers only, never a diagnosis or a reason in words. | Document store rules; leave permissions | Wording and retention |

## 3. Questions for the adviser

1. **P1.** Is a paid-sickness entitlement of 5 days a year, after 12 months' service, for people paid by the hour, compatible with any statutory or contractual minimum that applies to these workers and to casual or part-time work? What certificate must be accepted, and when? Is the entitlement counted per leave year or calendar year?
2. **P2.** Is **2.5% of the Basic part of pay** an acceptable way to provide annual leave pay to people paid by the hour, or is a minimum owed (for example on all pay, or a number of days)? If Basic is a small share of gross in the company's salary structures, does the result still meet any minimum?
3. **P3.** Is averaging **gross earnings** over 3 months acceptable for paid sickness and public holidays? **Which earnings should qualify** (we count weekday, weekend and holiday hours; we exclude leave, sick and holiday pay and any allowance outside hours)? Should overtime, premiums or allowances be in or out?
4. **P4.** Is a 12-month wait lawful for each of these entitlements, and does it apply to staff paid by the hour?
5. **P5.** Is leave, sick and holiday pay taxable and pensionable as part of gross? How are the pension and NHF taken from a supplementary payment relieved for PAYE (the open question in P5)?
6. **P6.** May an overpayment of holiday pay be recovered from later pay under the cap of 33.33% with the remainder carried forward? What consent, notice, written authority or cap does the law require, and what happens when the person leaves?
7. **P7.** Is the handling of sickness records, the certificate store and the retention appropriate under the data protection rules?

## 4. Review record (to be completed by the founder or the reviewer; the engineering must not fill it in)

One block per item. **Do not mark an item "production-ready" while its block is incomplete.**

| Item | Reviewer (name, firm) | Date | Outcome (approved as built / approved with amendments / conflict) | Approved policy wording | Required amendments | Founder decision on any conflict | Configuration change (rule version, date) |
|---|---|---|---|---|---|---|---|
| P1 paid sick days | | | **OUTSTANDING** | | | | |
| P2 leave pay on the Basic part | | | **OUTSTANDING** | | | | |
| P3 gross-earnings averaging | | | **OUTSTANDING** | | | | |
| P4 12-month wait | | | **OUTSTANDING** | | | | |
| P5 tax and pension treatment | | | **OUTSTANDING** | | | | |
| P6 recovery of an overpayment | | | **OUTSTANDING** | | | | |
| P7 sensitive data in sick leave | | | **OUTSTANDING** | | | | |

## 5. If a review finds a conflict

1. **Stop** the affected rule: do not switch it on for a production company.
2. **The founder decides** (amend the policy, or accept the difference in writing). The approved configuration is not changed before that decision.
3. An amendment is made as a **new effective-dated rule version** (or a settings change), by a person with the settings permission, **with a reason**; it is audited with who, when, and the old and new value. Nothing already paid is rewritten.
4. If the law needs behaviour the code does not have, it becomes a **new plan** with its own tests, migration and explain-back note.

## 6. What to give the adviser

The explain-back notes: `hourly-payroll-h14-piece1-explain-back.md` (leave pay), `hourly-payroll-h14-piece2a/2b/2c-explain-back.md` (paid sickness), `hourly-payroll-h14-piece3-explain-back.md` (holidays not worked), `hourly-leave-pay-basic-explain-back.md` (the Basic part), `hourly-average-gross-explain-back.md` (gross-earnings averaging), `hourly-sick-spell-correction-explain-back.md`, `hourly-holiday-late-shift-explain-back.md`, `hourly-holiday-adjustment-plan.md` and `hourly-holiday-adjustment-a-explain-back.md`, all in `docs/plans/`; and this register.

## 7. Engineering status of each policy (not a legal status)

Built and merged: P1 to P4 and P7 (as described), the P5 treatment (with the open question), and the record and review of P6. Applying the positive P6 difference in the next open payroll is built in the pending pull request for pieces B and D. **Not built: recovering a negative P6 difference.** Nothing above is switched on for a production company by the application: every rule is a setting a company chooses, and the demonstration company keeps leave pay off.
