-- Reverses 20270106100000_leave_basis_on_line: removes the note, on each stored leave pay line, of what its percentage was taken of.
-- The note is LOST (a stored line then shows its base without saying whether it is the Basic part or all the pay): run this only on a database that is being rolled back as a whole, after a backup if any leave pay has been calculated on the Basic part.
-- Nothing that existed before is touched (the migration only added a nullable column).
ALTER TABLE "HourlyAllowanceLine" DROP COLUMN "leaveBasis";
