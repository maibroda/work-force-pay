-- Reverses 20270102090000_sick_pay: removes the average-hours setting and the days paid on the stored extra pay lines of staff paid by the hour.
-- The setting and the paid days are LOST (the stored sick pay lines remain but can no longer say which days they paid, so a later supplementary payroll could pay a sick day twice): run this only on a database that is being rolled back as a whole,
-- and after a backup if any sick pay has been calculated. Nothing that existed before is touched (the migration only added a column with a default and a list column).
ALTER TABLE "HourlyAllowanceLine" DROP COLUMN "dates";
ALTER TABLE "PayrollRule" DROP COLUMN "hourlyAverageMonths";
