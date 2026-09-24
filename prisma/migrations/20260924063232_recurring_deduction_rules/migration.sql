-- CreateEnum
CREATE TYPE "DeductionScope" AS ENUM ('GLOBAL', 'LOCATION', 'INDIVIDUAL');

-- CreateEnum
CREATE TYPE "RecurringDeductionCalcType" AS ENUM ('PERCENTAGE_OF_GROSS', 'FIXED_AMOUNT');

-- CreateEnum
CREATE TYPE "CostCenterOwnerType" AS ENUM ('DEPARTMENT', 'CONTRACT', 'BEAT');

-- CreateTable
CREATE TABLE "RecurringDeductionRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "scope" "DeductionScope" NOT NULL,
    "beatId" TEXT,
    "employeeId" TEXT,
    "calcType" "RecurringDeductionCalcType" NOT NULL,
    "percentage" DECIMAL(6,3),
    "fixedAmount" DECIMAL(14,2),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "reason" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringDeductionRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecurringDeductionRule_organizationId_scope_idx" ON "RecurringDeductionRule"("organizationId", "scope");

-- CreateIndex
CREATE INDEX "RecurringDeductionRule_organizationId_beatId_idx" ON "RecurringDeductionRule"("organizationId", "beatId");

-- CreateIndex
CREATE INDEX "RecurringDeductionRule_organizationId_employeeId_idx" ON "RecurringDeductionRule"("organizationId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringDeductionRule_organizationId_code_key" ON "RecurringDeductionRule"("organizationId", "code");

-- AddForeignKey
ALTER TABLE "RecurringDeductionRule" ADD CONSTRAINT "RecurringDeductionRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringDeductionRule" ADD CONSTRAINT "RecurringDeductionRule_beatId_fkey" FOREIGN KEY ("beatId") REFERENCES "Beat"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringDeductionRule" ADD CONSTRAINT "RecurringDeductionRule_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
