-- Reverses 20261230090000_hourly_minimum_pay: removes the minimum-pay figure from every payroll rule version.
-- The figures entered are LOST, so run this only on a database that is being rolled back as a whole. Nothing that existed before is touched (the migration only added a column with a default of 0).
ALTER TABLE "PayrollRule" DROP COLUMN "hourlyMinMonthlyPay";
