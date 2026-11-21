# Explain-back note: cancelling an approved sick spell

On the founder's "CONTINUE" of 2026-11-21 after `hourly-sick-spell-correction-plan.md`: I built **the plan with its defaults** (HR only, never the employee, a reason required; a finding for Payroll, not an automatic deduction; a locked month can be cancelled). This changes how sick pay already paid is treated, so it is a pay change. If you wanted other answers to the plan's three questions, say so before it is merged.

## What it does, step by step

1. **HR can cancel an approved spell.** Before, only a spell waiting for approval could be cancelled. Now an approved one can too, by a person with the leave management right, **never the person it is about**, and **only with a reason of a few words**. The spell becomes CANCELLED. Who cancelled, when and why are kept on the spell (new columns); the **words of the reason are never put in the audit log**, which keeps ids and numbers only (and says the spell had been approved). A spell is never edited in place: **to correct dates or a certificate, cancel and record a new spell**, which goes through the normal approval by a different person.
2. **The entitlement is freed.** A cancelled spell no longer counts against the five paid days a year, and its dates can be recorded again.
3. **Not yet paid:** if no final payroll paid the days, nothing else happens: the next calculation simply leaves the days out (the pay run only pays approved spells).
4. **Already paid by a payroll that is final** (the month is approved, locked or paid): **no negative pay is ever made.** The first payroll calculated afterwards, regular or supplementary, shows **one critical finding** per cancelled spell: "[person] was paid sick pay for N days (dates) on a spell of sickness that HR has since cancelled. That is about NGN [amount] already paid. No negative pay is made: enter a deduction for the overpayment if it is to be recovered." The amount comes from the **stored sick pay line** (the share for the days concerned), not a recalculation.
5. **Once only.** The payroll that raised the finding is written on the spell; calculating that same payroll again keeps the finding; a **later payroll does not repeat it**. If that payroll was later replaced, the next one raises it again.
6. **A replacement is not paid twice and is not flagged.** A day covered by an approved spell (a corrected one) was not overpaid, so no finding; the pay run already remembers which days it paid, so the replacement pays only days not already paid. A day is reported once even if more than one cancelled spell covers it.
7. **The screen:** on the Leave page, an approved spell has a "Cancel (approved)" button that asks for the reason (not shown to HR for their own sickness); a cancelled spell shows who cancelled it and why.
8. **Migration `20270105090000_sick_spell_cancel`:** five optional columns on the sick spell (who, who's id, when, the reason, the payroll that raised the finding). Additive; `down.sql` drops them (the who, when and why are then lost).

## Where each rule comes from

The plan you approved by "CONTINUE", and the hourly pay's own rule that a correction after payment never makes negative pay (the finding "HOURLY_PAY_DECREASED", with the same advice to enter a deduction).

## Worked example (invented figures)

A guard's two sick days, Monday 1 and Tuesday 2 April, were paid in April: 2 x 8 h x 1,000 = **16,000.00**, and April is locked. HR then finds the certificate was not genuine and cancels the spell (reason kept on the spell). Payroll calculates May: no pay is made for the guard, and **one critical finding** says: "... paid sick pay for 2 days (2052-04-01, 2052-04-02) ... about NGN 16,000.00 already paid ... enter a deduction ...". Calculating May again shows the same finding; June shows none. If HR had instead recorded a corrected spell for the same two days, there would be no finding and nothing paid twice.

## What could go wrong

- The finding is **advice**: Payroll must enter the deduction (with the deduction rules that apply). Nothing is taken automatically.
- A payroll that was **calculated but never made final** is simply recalculated, so its days drop out and no finding is needed.
- If a person's overpaid days were paid across several months, one finding lists them together with the total.

## Which tests prove it

`tests/integration/sick-spell-cancel-pay.test.ts` (3): cancelled before it was paid (days dropped, no finding); already paid by a locked month (one critical finding with the days and amount, no negative pay, kept when calculated again, not repeated later, reason not in the message, marker on the spell); a replacement for the same days (no finding, not paid twice). `tests/integration/sick-spell.test.ts` (3 new, one changed): HR cancels with a reason (kept on the spell, audit has ids and numbers only, entitlement freed); a reason is needed, HR only, never the employee's own, and final; dates freed for a replacement and another company cannot cancel.
