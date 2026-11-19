-- Reverses 20261225090000_hourly_pay_foundation: removes the hourly pay tables, their protections and the two new types.
-- Nothing that existed before is touched (the migration only added tables). Every hourly rate, compensation record, holiday state and the hourly-pay switch is LOST, so run this only on a database that is being
-- rolled back as a whole, and after a backup if any of those have been entered.

DROP TRIGGER IF EXISTS wfp_compensation_type_protected ON "EmployeeCompensationType";
DROP FUNCTION IF EXISTS wfp_compensation_type_protect();
DROP TRIGGER IF EXISTS wfp_hourly_rate_protected ON "HourlyRate";
DROP FUNCTION IF EXISTS wfp_hourly_rate_protect();

DROP TABLE "EmployeeCompensationType";
DROP TABLE "HourlyRate";
DROP TABLE "HourlyPaySetting";
DROP TABLE "PublicHolidayState";

DROP TYPE "HourlyRateScope";
DROP TYPE "CompensationType";
