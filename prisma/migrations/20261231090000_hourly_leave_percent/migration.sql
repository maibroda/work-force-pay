-- CreateEnum
CREATE TYPE "HourlyAllowanceKind" AS ENUM ('LEAVE_PERCENT', 'SICK_DAY', 'HOLIDAY_NOT_WORKED');

-- AlterTable
ALTER TABLE "PayrollRule" ADD COLUMN     "hourlyLeavePct" DECIMAL(5,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "HourlyAllowanceLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "kind" "HourlyAllowanceKind" NOT NULL,
    "clientId" TEXT,
    "contractId" TEXT,
    "beatId" TEXT,
    "structureCode" TEXT NOT NULL,
    "baseAmount" DECIMAL(16,2),
    "pct" DECIMAL(5,2),
    "minutes" INTEGER,
    "rate" DECIMAL(14,2),
    "amount" DECIMAL(16,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HourlyAllowanceLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HourlyAllowanceLine_organizationId_runId_idx" ON "HourlyAllowanceLine"("organizationId", "runId");

-- CreateIndex
CREATE INDEX "HourlyAllowanceLine_recordId_idx" ON "HourlyAllowanceLine"("recordId");

-- AddForeignKey
ALTER TABLE "HourlyAllowanceLine" ADD CONSTRAINT "HourlyAllowanceLine_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HourlyAllowanceLine" ADD CONSTRAINT "HourlyAllowanceLine_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "PayrollRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

