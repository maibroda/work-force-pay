-- AlterTable
ALTER TABLE "HourlyAllowanceLine" ADD COLUMN     "dates" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "PayrollRule" ADD COLUMN     "hourlyAverageMonths" INTEGER NOT NULL DEFAULT 3;

