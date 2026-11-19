# Explain-back note: hourly pay follow-ups (national holidays for the paid-days basis; shifts in the data copy)

Two small changes on the founder's answers of 2026-11-19: **H17** and "yes, add time entries to a person's data copy". **No migration.** Files: `src/server/services/holidays.ts` (`holidayContext`), `src/server/services/data-requests.ts`, `src/lib/data-requests.ts` (the "left out" list), a comment in `prisma/schema.prisma`. Tests: `tests/integration/hourly-data-copy-and-holidays.test.ts` (6).

## 1. H17: the contract paid-days basis considers only national holidays (touches an input to the pay run)

**What it does, step by step**
1. A contract can be paid on "working days, public holidays excluded" (`docs/plans/paid-days-basis.md`). The pay run reads the year's public holidays through `holidayContext` to take those days out of the month.
2. Since hourly pay phase 2, a holiday can be limited to named states (the hourly rule: the state of the work location decides). Those holidays were still being read by `holidayContext`, so a Lagos-only holiday would have removed a working day from **every** contract on that basis, whatever state its sites are in.
3. Now `holidayContext` returns only holidays with **no states** (national holidays). A holiday limited to states is used by hourly pay alone.

**Where the rule comes from.** Your answer H17 of 2026-11-19: "National holidays only".

**Worked example.** A company lists Independence Day (1 October, national) and a Lagos-only holiday on 2 November. A contract on "working days, public holidays excluded" is paid for November: the pay run takes out only national holidays, so 2 November stays a working day for the contract. A guard on hourly pay working a Lagos site on 2 November is paid the holiday rate (the state of the work location decides).

**What could go wrong, and what is NOT covered**
- **Nothing changes for any company today.** State limits can only be set when hourly pay is switched on, and no company has done so. A company that never limits a holiday gets exactly the list it always had (a test checks this).
- **A contract that should take a state's holiday does not.** If a contract's sites are all in one state and the client treats that state's holiday as a non-working day, this basis will not take it out. That would need a rule for the contract's state (you considered it and chose national only).
- The holiday list's year confirmation is unchanged.

**Tests that prove it.** A national holiday counts and a state-limited one does not; a company that never limits a holiday gets exactly its old list; limiting a holiday and then making it national again puts it back. With the change reverted, two of the three failed.

## 2. A person's data copy lists their hourly shifts

**What it does.** The person's own copy of their data gets a section "Hourly shifts (clock-in and clock-out times, Nigerian time)": for each shift the site, the clock-in and clock-out as Nigerian wall-clock time ("2026-11-20 19:00", or "not entered"), the status (draft, submitted, approved, rejected, withdrawn or superseded), and the approved hours (only for an approved shift). It never includes the words typed about a shift (a rejection note or the reason for a correction), which the copy's "left out" list now says plainly, nor anyone else's shifts or name.

**What could go wrong, and what is NOT covered**
- **Erasure is NOT built.** When a person is erased, the words typed on their shifts (rejection notes, correction reasons) should be cleared. The database protects every time entry from any change (a rule I built in phase 3 so approved hours can never be edited), so clearing those two fields needs a **small migration** that allows exactly that change and nothing else, with a `down.sql` and a test. I said "no migration" when asking, and that was wrong for erasure: **I need your go for it.** Until then, a rejection note or correction reason survives the erasure of the person's other data (it holds no name, but it could mention one).
- A person with a very long history gets a long list (one row per shift).

**Tests that prove it.** The person's shifts appear with the site, Nigerian times, status and approved hours (11.5 hours for the worked 19:00-07:00 shift with a half-hour break); a draft with no clock-out reads "not entered" with no approved hours; someone else's shift and name are absent; a rejection note typed on a shift is absent from the copy; another company's person gets none of this company's shifts. With the change reverted, the two tests that look at what the copy contains failed (the third, about another company, passes either way).
