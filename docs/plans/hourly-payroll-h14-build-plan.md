# Build plan: leave, sickness and holidays for people paid by the hour (H14)

For the founder to read and say "go" to, one piece at a time. **Nothing here is built.** It turns your answers of 2026-11-20 (to `hourly-payroll-h14-leave-plan.md`) into pieces. As always: tests first, a reversible migration for any new table or column, everything off by default, an explain-back note and a pull request for each piece. The labour-law question (what an hourly or casual worker is owed, and whether 5 days and the percentage you choose meet it) stays with your lawyer; I assume none of it.

## 1. What you decided (recorded; I will also put it in `decision-register.md` with the first piece)

| Topic | Your answer |
|---|---|
| Annual leave | **Option D: a percentage added to every hour worked.** The figure is yours or your adviser's, a company setting, never in the code. **Only after 12 months' service**, as for monthly staff. |
| Sickness | **Paid, 5 days a year. A medical certificate is needed and HR approves.** Paid at the person's **average daily hours x their weekday rate**. |
| Public holidays not worked | **Paid**, at the same **average daily hours x weekday rate**. |
| Eligibility | **Same as monthly staff** (12 months' service by the company's leave policy). |
| Minimum hours (H7) | **No minimum** (as built). |

## 2. The questions I still need answered (with what I would do if you say "your choice")

1. **The percentage figure.** A number for you or your adviser; I will build the setting at 0 (= off) and you enter it. *Nothing to answer now unless you have it.*
2. **What the percentage is a percentage of.** My recommendation: **all pay for hours worked** (weekday, weekend and holiday hours alike), from the day the person completes 12 months' service. It is not added on sick days or holidays not worked (no hours are worked on them).
3. **"Average daily hours".** Three choices to make: (a) **the period**: I suggest **the 3 months before the day**, kept as a company setting; (b) **per day worked** (total approved hours divided by the days they worked) or **per working day** (divided by every working day of the period). I recommend **per day worked**: it follows what a normal day is for that person (a person who works 3 long days a week is not paid a short day); (c) a person with less than the period of history uses what they have; **a person with no approved hours in the period has nothing to average, so nothing is paid and a finding says so**.
4. **Which days count as "their usual days"** for a paid holiday not worked and a paid sick day. A person paid by the hour has no fixed schedule, so something must say a day is one they would have worked. My recommendation: **a day of the week they worked at least once in the same period** (so a person who never worked Sundays is not paid for a Sunday holiday or a Sunday of sickness). Alternatives: every working day of the company's leave week, or every holiday regardless.
5. **Which holidays.** The holiday must apply to the person's **work location state** (your H11, the same rule that already decides the holiday rate), on a date they were employed and paid by the hour, and **not** a day they worked (a worked holiday is already paid at the holiday rate).
6. **The sick year.** Do the 5 days run in **the same leave year as annual leave** (counted from the person's service) or in **the calendar year**? I recommend the same leave year, as the system already counts it for monthly staff. Days beyond 5 are unpaid.
7. **Is the percentage, sick pay and holiday pay part of gross?** My assumption, to confirm: **yes, they are earnings like hourly pay**: taxed through PAYE the same way, counted for pension, divided by the salary structure of the person's site (your H8 and H12), and shown on the payslip as their own lines ("Leave pay", "Sick pay", "Holiday pay"). If a person has no hours in the month (only a sick day, say), the structure used is **the site where they last worked**.
8. **Who records a sick spell and who approves.** My proposal: the person, their supervisor or HR records it with the certificate; **HR approves, and not the person who recorded it** (the same rule as other approvals); the certificate is kept as a **medical document in the existing document store, which already restricts medical files to people with sensitive access and audits their upload and approval** (I did not find a log of who merely opened a medical file; if you want one, that is a separate small piece). The leave record itself holds only dates and days, **never a diagnosis**, and the audit log holds ids and numbers only.

## 3. The pieces, in order

| # | Piece | New data (all reversible, off by default) | Size |
|---|---|---|---|
| **0** | **Safeguard, now.** Approved annual leave for a person paid by the hour is silently unpaid today. Until piece 1 exists the system says so clearly when HR approves it, and the payroll shows a finding for an hourly person with approved leave. After piece 1 the message points to the percentage. No amount changes. | none | small |
| **1** | **The leave percentage (option D), and the plumbing every later piece reuses.** The percentage setting in the payroll rules (effective-dated, 0 = off, like the minimum-pay figure), the 12-month rule, a stored line for each allowance (a new table, so the existing hourly reports and payslip are not disturbed), the engine taking allowances as earnings split by the site's structure, the payslip line "Leave pay", the reports, and the late-hours (supplementary) handling so nothing is paid twice. Annual leave **days** for hourly staff are no longer requested: their leave pay is the percentage. | one setting column, one table | medium |
| **2** | **Paid sickness.** A sick spell (dates, days; no diagnosis), 5 days a year as a setting, the certificate as a medical document, HR approval by a different person, the average-hours calculation (3-month period as a setting), the "usual days" rule, the payslip line "Sick pay". | one table, two settings | large |
| **3** | **Paid public holidays not worked.** For each public holiday in the month that applies to the person's state, was a usual day for them, and was not worked: average daily hours x weekday rate, as the line "Holiday pay"; listed so Payroll can see who was paid and why. | none beyond piece 1's table | medium |
| **4** | **The 3,000-person test again**, now with people past 12 months' service, sick spells and holidays, so the history reads (the 3-month averages) are proved inside the 10-minute rule. The averages are worked in the database for the whole company at once, not person by person. | none | small |

Each piece is its own pull request, in this order (1 before 2 and 3, since they reuse its stored line and engine input; 0 can go first and alone). Pieces 2 and 3 can be swapped.

## 4. How I will keep it correct (the same checks as the rest of the hourly pay)

- **Money:** whole kobo, rounded half up once per line; the hours, the average and the rate used are stored on the payroll record, so a later change to a rate cannot alter a past payroll.
- **Nobody is paid twice** for the same day (a worked holiday is paid once, at the holiday rate; a sick day and a holiday on the same day are paid once; leave pay is not added to the days that are themselves paid as sick or holiday).
- **Findings, not guesses:** no average (no hours in the period), no rate, no site structure, or an unapproved sick spell all stop that line and raise a finding that says which, never a silent zero.
- **Late and corrected items** (a sick spell approved after the payroll is locked) go through the supplementary payroll the same way late hours do.
- **Tests proving each rule** with worked examples: before and after the 12-month date; exactly 5 days and a sixth; a holiday on a day they do and do not usually work; a person with fewer than 3 months of history; no history; a holiday in another state; a sick day on a worked holiday; recalculation changes nothing; another company cannot read any of it.
- **Privacy:** medical certificates only through the existing sensitive-document rules; leave records hold no diagnosis; reports and the payslip show the kind of pay, never the reason.

## 5. What I need to start

1. Your answers to questions 2 to 8 above (or "your choices" and I use my recommendations, listed again in the first piece's explain-back note for you to correct).
2. Your "go" for piece 0 (no migration) and, separately, for piece 1 (one column and one table).

## 6. Not in this plan

Overtime and night premiums (H4), hourly client billing (H15), notice and end-of-service pay for hourly staff, and the legal question itself.

## 7. Your choices, recorded 2026-11-21

You answered "your choices" to questions 2 to 8, so I will build **my recommendations**; correct any of them before the piece that uses it:

- **Q2** the percentage is a percentage of all pay for hours worked (weekday, weekend and holiday), from the day the person completes 12 months' service; not added on sick days or holidays not worked.
- **Q3** average daily hours = approved hours over the 3 months before the day (a company setting), divided by the days they worked; fewer months of history uses what exists; no hours in the period means nothing is paid and a finding says so.
- **Q4** a day counts as one of a person's usual days when they worked that day of the week at least once in the same period.
- **Q5** a paid holiday not worked: applies to the person's work location state, on a date they were employed and paid by the hour, and not a day they worked.
- **Q6** the 5 sick days run in the same leave year as annual leave; days beyond 5 are unpaid.
- **Q7** the percentage, sick pay and holiday pay are part of gross (PAYE and pension as for hourly pay), divided by the salary structure of the person's site (the site where they last worked when a month has no hours), each shown on the payslip as its own line.
- **Q8** HR approves a sick spell and not the person who recorded it; the certificate is a medical document in the existing store; the leave record holds dates and days, never a diagnosis.

**Piece 0** (the safeguard) is built on your go of 2026-11-21: `hourly-payroll-h14-piece0-explain-back.md`. **Piece 1** (the leave percentage, one migration) is built on your go of 2026-11-21: `hourly-payroll-h14-piece1-explain-back.md`. **Piece 2** (paid sickness) is large, so it is built in three steps on your "CONTINUE" of 2026-11-21: **2a** records and approves a spell of sickness, no pay (`hourly-payroll-h14-piece2a-explain-back.md`); **2b** the pay (`hourly-payroll-h14-piece2b-explain-back.md`); **2c** the screens (`hourly-payroll-h14-piece2c-explain-back.md`). **Piece 3** (paid public holidays not worked) is built on your "CONTINUE" of 2026-11-21: `hourly-payroll-h14-piece3-explain-back.md`. Piece 4 waits for your separate go.
