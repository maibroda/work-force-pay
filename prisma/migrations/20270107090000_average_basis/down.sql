-- Reverses 20270107090000_average_basis: removes the setting that says how a paid sick day and a paid holiday not worked are valued, the kinds of day it counts, and the breakdown kept on each stored line.
-- A rule version then values those days at the average hours times the weekday rate again, and the breakdowns kept on stored sick and holiday lines are LOST: run this only on a database that is being rolled back as a whole, after a backup if any sick or holiday pay has been calculated on the gross earnings.
-- Nothing that existed before is touched (the migration only added columns with defaults, a nullable column and a type).
ALTER TABLE "HourlyAllowanceLine" DROP COLUMN "breakdown";
ALTER TABLE "PayrollRule" DROP COLUMN "hourlyAverageHoliday",
DROP COLUMN "hourlyAverageWeekend",
DROP COLUMN "hourlyAverageWeekday",
DROP COLUMN "hourlyAverageBasis";
DROP TYPE "HourlyAverageBasis";
