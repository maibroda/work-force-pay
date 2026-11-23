-- Reverses 20270109090000_holiday_adjustment: removes the table of holiday adjustments (a public-holiday shift approved after the day was paid as not worked) and its status type.
-- Every adjustment proposed, approved or rejected, with its figures and who reviewed it, is LOST (the audit log keeps the ids and numbers): run this only on a database that is being rolled back as a whole, after a backup if any adjustment exists.
-- Nothing that existed before is touched (the migration only added a table and a type).
DROP TABLE "HolidayAdjustment";
DROP TYPE "HolidayAdjustmentStatus";
