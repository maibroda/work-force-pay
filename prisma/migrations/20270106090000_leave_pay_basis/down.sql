-- Reverses 20270106090000_leave_pay_basis: removes the setting that says what the leave percentage is taken of.
-- A rule version set to BASIC then works as ALL_PAY again (the percentage is taken of all the pay): run this only on a database that is being rolled back as a whole, after a backup if any rule version has been set to BASIC.
-- Nothing that existed before is touched (the migration only added a column with a default and a type).
ALTER TABLE "PayrollRule" DROP COLUMN "hourlyLeaveBasis";
DROP TYPE "HourlyLeaveBasis";
