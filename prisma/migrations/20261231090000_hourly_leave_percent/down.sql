-- Reverses 20261231090000_hourly_leave_percent: removes the leave percentage from every payroll rule version and the stored breakdown of hourly staff's extra pay.
-- The percentages entered and every stored line of extra pay (leave pay on payrolls already calculated) are LOST, so run this only on a database that is being rolled back as a whole, and after a backup if any hourly payroll has been
-- calculated with a leave percentage. Nothing that existed before is touched (the migration only added a column with a default of 0, a table and a type).
DROP TABLE "HourlyAllowanceLine";
DROP TYPE "HourlyAllowanceKind";
ALTER TABLE "PayrollRule" DROP COLUMN "hourlyLeavePct";
