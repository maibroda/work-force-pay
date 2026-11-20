-- Reverses 20261228090000_hourly_pay_lines: removes the stored breakdown of hourly pay. Nothing that existed before is touched (the migration only added a table).
-- Every stored hourly pay line is LOST, so run this only on a database that is being rolled back as a whole, and after a backup if any hourly payroll has been calculated.
DROP TABLE "HourlyPayLine";
