-- AlterEnum
ALTER TYPE "HolidayAdjustmentStatus" ADD VALUE 'APPLIED';

-- AlterEnum
ALTER TYPE "HourlyAllowanceKind" ADD VALUE 'HOLIDAY_ADJUSTMENT';

-- AlterTable
ALTER TABLE "HolidayAdjustment" ADD COLUMN     "appliedAt" TIMESTAMP(3),
ADD COLUMN     "appliedRunId" TEXT;
