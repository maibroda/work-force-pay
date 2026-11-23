-- Reverses 20270110090000_holiday_adjustment_apply: removes the "applied" status of a holiday adjustment, the kind of pay line that holds its net difference, and the link to the payroll that applied it.
-- DESTRUCTIVE for any adjustment already applied: the pay lines "Holiday adjustment" it made in a regular payroll are DELETED (their amounts stay in that payroll's gross, so that payroll no longer adds up to its lines), and an applied adjustment goes back to approved, so a later payroll could pay it again.
-- Run it only on a database that is being rolled back as a whole, and after a backup if any adjustment has been applied. Nothing else that existed before is touched.

DELETE FROM "HourlyAllowanceLine" WHERE "kind" = 'HOLIDAY_ADJUSTMENT';
UPDATE "HolidayAdjustment" SET "status" = 'APPROVED' WHERE "status" = 'APPLIED';
ALTER TABLE "HolidayAdjustment" DROP COLUMN "appliedRunId", DROP COLUMN "appliedAt";

ALTER TYPE "HourlyAllowanceKind" RENAME TO "HourlyAllowanceKind_old";
CREATE TYPE "HourlyAllowanceKind" AS ENUM ('LEAVE_PERCENT', 'SICK_DAY', 'HOLIDAY_NOT_WORKED');
ALTER TABLE "HourlyAllowanceLine" ALTER COLUMN "kind" TYPE "HourlyAllowanceKind" USING ("kind"::text::"HourlyAllowanceKind");
DROP TYPE "HourlyAllowanceKind_old";

ALTER TYPE "HolidayAdjustmentStatus" RENAME TO "HolidayAdjustmentStatus_old";
CREATE TYPE "HolidayAdjustmentStatus" AS ENUM ('PROPOSED', 'APPROVED', 'REJECTED');
ALTER TABLE "HolidayAdjustment" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "HolidayAdjustment" ALTER COLUMN "status" TYPE "HolidayAdjustmentStatus" USING ("status"::text::"HolidayAdjustmentStatus");
ALTER TABLE "HolidayAdjustment" ALTER COLUMN "status" SET DEFAULT 'PROPOSED';
DROP TYPE "HolidayAdjustmentStatus_old";
