# Plan: leave, sickness and absence for people paid by the hour (H14)

For the founder to read and decide. **Nothing here is built.** It is the one open piece of the hourly payroll (decision H14 in `hourly-payroll-assessment.md`: "are they paid for these?"). I have not checked the labour law and do not assume it: what an hourly or casual worker is entitled to is **a question for your lawyer**, and this plan is written so that whichever answer you get can be built.

## 1. What happens today (what I found in the code)

- **Leave in WorkforcePay is one thing: annual leave.** 10 working days a year by default, due after 12 months' service, plus an **optional unpaid leave** that a company can switch on. Approving a request writes "LEAVE" days into the work register (for a person with a site assignment). **For a monthly person those days are paid days.**
- **There is no sickness leave at all** (no type, no days, no certificate). Nor any rule for absence.
- **A person paid by the hour is paid only for approved hours.** The pay run drops every work-register day from the days they are paid by the hour (so nobody is paid monthly and hourly for the same day).
- **So today, if an hourly person asks for annual leave and HR approves it, nothing is paid and nothing warns anyone.** The system accepts the request, shows the days as "leave", and the payslip has no leave pay. This is the one thing I would fix whatever you decide (see section 5). I found it by reading the code (leave approval, then the pay run); I have not run it end to end.
- Public holidays: a holiday that is **worked** is paid at the public holiday rate (your H3). A holiday that is **not** worked is paid nothing.

## 2. The decisions I need from you

**D1. Are people paid by the hour paid for annual leave?**

| Option | What it means | Pay on a leave day | Effort |
|---|---|---|---|
| **A. No** | They are paid for hours worked only. Leave is time off, unpaid. | Nothing | Small: refuse or clearly label leave for hourly staff; no pay change. |
| **B. At their average** | A leave day is paid as the hours they normally work: the average of their approved hours over a period you choose (say, the last 3 months), at their weekday rate. | Average daily hours x weekday rate | Medium: needs their hours history, a new pay line, a migration. |
| **C. At agreed hours** | Each person has an agreed number of hours per day (for example in their contract or hourly rate record); a leave day is paid as those hours at the weekday rate. | Agreed hours x weekday rate | Medium: a new setting per person, a new pay line, a migration. |
| **D. Added to every hour** | A percentage (set by you) is added to every hour worked to stand for leave pay, paid as it is earned. No separate leave days. | Percentage x hourly pay | Small to medium: a company setting and a pay line; leave then needs no pay. |

My honest view: **A is the simplest and is a business and legal choice, not a technical one.** If your lawyer says hourly or casual staff must have paid leave, B or C follows a person's real working pattern and D is the easiest to run. I will not choose between them.

**D2. Sickness.** Is sick leave paid for hourly staff? If yes: how many days a year, does it need a medical certificate, who approves, and is it paid at the same basis as D1 (average or agreed hours)? Today there is no sickness leave in the system, so even a "yes" means building the sickness type first.

**D3. Public holidays not worked.** A holiday that falls on a day an hourly person would normally work and does not: paid or not? (Today: not paid.)

**D4. If anything is paid: what kind of pay is it?** My assumption, for you to confirm or change: leave pay is **part of gross earnings**, taxed through PAYE and counted for pension exactly like hourly pay, split by the site's salary structure (your H8 and H12), and stored as its own line so the payslip can show "Leave pay". Who bears the cost is not billed to the client (your H15 puts hourly client billing out of scope).

**D5. Who may take it?** Same eligibility as monthly staff (12 months' service by default) or different? Does it use the same 10 days, or a separate allowance for hourly staff?

**D6. Minimum hours (H7)** is still open and interacts: if an hourly person is guaranteed a minimum number of hours, that is a different promise from paying for leave. I would decide H7 at the same time so the two do not contradict each other.

## 3. How each option would be built (so you can judge the size)

All of it is behind the existing hourly switch, off by default, and none of it changes a monthly person's pay.

- **Option A** (no pay): no new data. The leave request for an hourly person is refused with a clear message, or accepted but marked "unpaid" and the payslip and reports show it as unpaid time. No migration.
- **Options B and C** (paid leave days): a new kind of pay line for leave days (hours and the rate used, kept like the hourly pay lines), a new approved-leave-days read in the pay run, the average-hours calculation (B) or an agreed-hours field (C), payslip and report lines, **one migration** (reversible, with a down script). The pure calculation comes first with tests, then the engine takes it as another earnings input, as it does hourly hours today.
- **Option D** (percentage on every hour): one new company setting (effective-dated like the minimum-pay figure), added to the hourly gross as its own line. **One small migration.** No leave days to track.
- **Sickness (if paid):** a new leave type with its own entitlement, certificate and approval, then paid by the same mechanism as the option you choose for D1. This is the largest part and I would do it as a separate step.
- **Always, if anything is paid:** tests first; exact money (whole kobo, rounded half up once); the hours and rate stored on the payroll record so a later change cannot alter a past payroll; the payslip shows leave pay separately; the minimum-pay warning (H13) counts leave pay as earnings; late and corrected leave goes through the supplementary payroll like late hours. About 3 to 4 pieces of work, each with its own pull request and explain-back note.

## 4. How it fits with what is built

- **H20** (never paid monthly and hourly for the same day) is unchanged: a leave day is paid once, as leave pay.
- **The work register** keeps writing "LEAVE" days for approved leave; for an hourly person the pay run would read the approved leave itself (not the register day), so the rule that drops register days for hourly staff stays.
- **Late hours and corrections** (H22) work the same way for leave pay: paid by a supplementary payroll, never twice.
- **The performance limit** (3,000 people in 10 minutes) would be re-measured after the change.

## 5. One thing I recommend doing now, whatever you decide (small, no migration)

Today an approved annual leave request for a person paid by the hour is silently unpaid. I suggest a small safeguard until D1 is answered: **when HR approves annual leave for a person paid by the hour, the system says clearly that it is not paid (or refuses it), and the payroll shows a finding for any hourly person with approved leave in the month**, so nobody is surprised on pay day. It changes no amount. Say "yes" and I will build it as its own small piece, tests first.

## 6. What I need from you to start

1. **D1** A, B, C or D (or "ask the lawyer first" and I wait).
2. **D2** sickness: paid or not; if paid, days a year, certificate, who approves.
3. **D3** public holidays not worked: paid or not.
4. **D5** eligibility: same as monthly staff or different.
5. For B: the period for the average (for example the last 3 months). For C: where the agreed hours live (my suggestion: on the person's hourly pay record). For D: the percentage, which is your or your adviser's figure; I will put none in the code.
6. Whether to do the section 5 safeguard now.

## 7. Not in this plan

Overtime and night premiums (H4, not built), minimum hours (H7, decide together with this), hourly client billing (H15, out of scope), notice pay and end-of-service pay for hourly staff (not asked), and the legal question itself.
