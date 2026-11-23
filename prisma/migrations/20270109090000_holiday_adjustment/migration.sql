-- CreateEnum
CREATE TYPE "HolidayAdjustmentStatus" AS ENUM ('PROPOSED', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "HolidayAdjustment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "holidayDate" DATE NOT NULL,
    "timeEntryId" TEXT NOT NULL,
    "shiftApprovedBy" TEXT NOT NULL,
    "shiftApprovedByUserId" TEXT NOT NULL,
    "shiftApprovedAt" TIMESTAMP(3) NOT NULL,
    "originalRunId" TEXT NOT NULL,
    "originalLineId" TEXT NOT NULL,
    "originalClassification" TEXT NOT NULL,
    "originalPaid" DECIMAL(16,2) NOT NULL,
    "workedMinutes" INTEGER NOT NULL,
    "correctedEntitlement" DECIMAL(16,2),
    "netDifference" DECIMAL(16,2),
    "breakdown" JSONB,
    "status" "HolidayAdjustmentStatus" NOT NULL DEFAULT 'PROPOSED',
    "reviewedBy" TEXT,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HolidayAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HolidayAdjustment_organizationId_status_idx" ON "HolidayAdjustment"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "HolidayAdjustment_organizationId_employeeId_holidayDate_key" ON "HolidayAdjustment"("organizationId", "employeeId", "holidayDate");

-- AddForeignKey
ALTER TABLE "HolidayAdjustment" ADD CONSTRAINT "HolidayAdjustment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HolidayAdjustment" ADD CONSTRAINT "HolidayAdjustment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
