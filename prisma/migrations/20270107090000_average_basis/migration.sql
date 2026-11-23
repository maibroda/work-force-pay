-- CreateEnum
CREATE TYPE "HourlyAverageBasis" AS ENUM ('HOURS_AT_WEEKDAY_RATE', 'GROSS_EARNINGS');

-- AlterTable: every EXISTING rule version keeps the first build's method (the average daily hours times the weekday rate), so no past or open payroll changes; a NEW version starts on the gross earnings
ALTER TABLE "PayrollRule" ADD COLUMN     "hourlyAverageBasis" "HourlyAverageBasis" NOT NULL DEFAULT 'HOURS_AT_WEEKDAY_RATE',
ADD COLUMN     "hourlyAverageWeekday" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "hourlyAverageWeekend" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "hourlyAverageHoliday" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "PayrollRule" ALTER COLUMN "hourlyAverageBasis" SET DEFAULT 'GROSS_EARNINGS';

-- AlterTable
ALTER TABLE "HourlyAllowanceLine" ADD COLUMN     "breakdown" JSONB;
