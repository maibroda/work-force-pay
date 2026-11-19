# Explain-back note: erasing a person clears the words on their hourly shifts

The founder said "go with the erasure migration" on 2026-11-20, the follow-up to putting hourly shifts in a person's data copy (#242). **One migration** (`20261227090000_time_entry_erasure`, with `down.sql`): it replaces one database protection function and adds no table, column or data. Files: the migration, `src/server/services/employee-retention.ts` (one line in `anonymizeEmployee`), `tests/integration/time-entry-erasure.test.ts` (6 tests).

**Why a migration was needed.** When hourly time entries were built (phase 3), the database was made to refuse every change to a decided entry (approved, rejected, withdrawn or replaced), so approved hours could never be edited. That protection also blocked clearing the two free-text fields: the reason typed for a correction and the note typed on a rejection. Those words can mention a person, so erasing a person must clear them.

**What it does, step by step**
1. **The database allows exactly one extra change to a time entry in any state:** setting its `reason` and/or `decisionNote` to nothing, while nothing else about the row changes. (An update that changes nothing is also harmless and is allowed.) Changing those words to other words, clearing them together with any other change (a time, the status, the approved minutes), and deleting an entry are all still refused.
2. **Erasing a person** (the existing step that anonymises a former employee) now clears the reason and note on every one of that person's time entries that has any. What stays is the facts a pay record needs: the times, the status, the approved hours, the paid pieces and who approved.
3. **A colleague's entries are never touched.**

**Where the rule comes from.** Your "go" of 2026-11-20 and the rule that personal words are cleared on erasure while the facts stay (as for every other HR record).

**Worked example.** A guard's shift on 3 November was approved, then corrected twice: each correction carries a typed reason ("left an hour early"), and an earlier shift was rejected with the note "suspected padding of hours". When the guard is erased, all three pieces of text go; the 3 November shift still shows 6 approved hours, who approved it, and its paid pieces. A colleague's identical-looking entries keep their own words.

**What could go wrong, and what is NOT covered**
- **The words on a person's shifts are cleared only when the person is erased.** A scheduled retention run does not clear them: the retention schedule has no category for time entries, and the retention periods are on hold for the lawyer's review (decision register item 4). If you want a category for hourly shifts, that is a separate decision.
- **The names of the staff who captured, completed or approved a shift** (`capturedBy`, `decidedBy`) are not cleared: they are the people at work, not the erased person, and are part of the record of who approved pay.
- **Rolling back.** `down.sql` puts back the earlier function exactly (checked by comparing its stored definition before and after), after which an erasure of a person whose shifts have words would fail until the migration is applied again. Run it only on a database being rolled back as a whole.
- **Not covered:** the audit log never held these words (it carries ids, times and numbers only).

**Tests that prove it.** The database allows clearing the note on a rejected entry and the reason on an approved correction and on a replaced one; it refuses changing the words to other words, clearing them together with a time, the approved minutes or the status, and deleting an entry; the ordinary flow (a note written when an entry is rejected) still works; erasing a person clears every note and reason on their entries and keeps their times, status, approved hours and paid pieces, and the count is right; no typed word is left in any of their entries in any state; a colleague's words are untouched; a person with no shifts is erased as before. I confirmed the tests have teeth: with the database function reverted and the erasure step removed, the three tests that look for the change failed (the three that check what is still refused kept passing). I also ran the migration up, down and up on a copy of the test database: `down.sql` restores the original function exactly, and no table changed.
