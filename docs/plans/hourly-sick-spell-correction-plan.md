# Plan: cancelling or correcting an approved sick spell (staff paid by the hour)

For the founder to read and say "go" to. **Nothing here is built.** Written 2026-11-21.

## 1. The gap

A spell of sickness can be cancelled **only while it waits for approval** (`cancelSickSpell`: "once approved it can no longer be cancelled here"). After HR approves it, it is final. So if HR approves by mistake (wrong person, wrong dates, a certificate later found to be wrong), nothing in the system can undo it, and if payroll has already paid the days there is no way to see or recover the overpayment.

## 2. What I propose (my recommendations; correct any of them)

1. **An approved spell can be cancelled by HR, with a reason.** It becomes CANCELLED (the status already exists). The reason is kept on the spell (words only there, never in the audit log, as with a rejection); the audit log gets ids and numbers only. Who cancelled and when are stored.
2. **No editing in place.** To correct dates or a certificate, **cancel and record a new spell**. The new one goes through the normal rules (recorded by one person, approved by a different HR person, not the employee). History is never overwritten.
3. **The five paid days a year are freed.** A cancelled spell no longer counts against the person's entitlement, so a correct replacement is paid in full.
4. **Not yet paid:** if no payroll has paid the days, cancelling is enough: the next calculation simply leaves them out.
5. **Already paid (the days are on a calculated and frozen payroll): no negative pay is ever made** (the same rule the hourly pay already follows for hours corrected after payment, finding `HOURLY_PAY_DECREASED`). Instead the next payroll shows a **critical finding**: the person, the days paid and the amount, with the instruction to enter a deduction for the overpayment, which Payroll decides and enters. The amount is read from the stored sick pay line (what was actually paid), not recalculated.
6. **A replacement spell for the same days is not paid twice**: the pay run already remembers which days it has paid (from the stored lines), so a corrected spell that covers days already paid pays only the days not yet paid.
7. **The finding is raised once**, in the first payroll calculated after the cancellation (and kept if that payroll is calculated again), so it does not repeat every month for ever.

## 3. Questions for you (default if you say "your choice")

1. **Who may cancel an approved spell?** Default: **HR (the right that approves spells), never the employee themselves, and a reason is required.** Alternative: also require that it is not the same person who approved it (stricter, but HR teams are often one or two people).
2. **Overpayment: a finding for Payroll to deduct (my default), or the system deducts automatically?** Default: finding only, because a deduction reduces someone's pay and the founder's rules on deductions (caps, consent) apply; the system should not take money on its own.
3. **Should a spell approved in a payroll month already locked be cancellable?** Default: yes (that is exactly the overpayment case above).

## 4. What I would build (one pull request)

- **One migration, reversible:** four optional columns on `SickSpell` (who cancelled it, when, the reason, and the payroll run that raised the overpayment finding). Additive only; the down script drops them.
- The service: cancel an approved spell (HR right, reason, audit), the entitlement ignores it, and the pay run's finding for days already paid.
- The screen: a "Cancel" button with a reason box on an approved spell in the Sickness section of the Leave page (already there for pending spells), and the cancelled spell shown with its reason to HR.
- **Tests first:** cancel approved (reason required, HR only, not the employee, another company cannot); entitlement freed; not-yet-paid spell vanishes from the next calculation; paid spell raises the critical finding once with the amount from the stored line; recalculation of the same run keeps it, a later run does not repeat it; a replacement spell for the same days is not paid twice; no negative pay anywhere; audit has ids and numbers only.
- Docs: explain-back note, release notes, data dictionary.

## 5. Not in this plan

Cancelling or correcting a paid public holiday (a different case: the holiday pay is rule-based), automatic deductions, and anything about the medical certificate beyond the link already there.
