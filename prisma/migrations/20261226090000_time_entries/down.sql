-- Reverses 20261226090000_time_entries: removes the time entry tables, their protections and the two new types.
-- Nothing that existed before is touched (the migration only added tables). Every time entry, break and paid piece is LOST, so run this only on a database that is being rolled back as a whole, and after a backup
-- if any time entry has been entered.

DROP TRIGGER IF EXISTS wfp_time_entry_segment_protected ON "TimeEntrySegment";
DROP TRIGGER IF EXISTS wfp_time_entry_break_protected ON "TimeEntryBreak";
DROP FUNCTION IF EXISTS wfp_time_entry_children_protect();
DROP TRIGGER IF EXISTS wfp_time_entry_protected ON "TimeEntry";
DROP FUNCTION IF EXISTS wfp_time_entry_protect();

DROP TABLE "TimeEntrySegment";
DROP TABLE "TimeEntryBreak";
DROP TABLE "TimeEntry";

DROP TYPE "DayClass";
DROP TYPE "TimeEntryStatus";
