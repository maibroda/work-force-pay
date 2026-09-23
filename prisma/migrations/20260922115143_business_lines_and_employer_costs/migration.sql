-- CreateEnum
CREATE TYPE "BusinessLine" AS ENUM ('GUARDING', 'OUTSOURCING');

-- AlterTable
ALTER TABLE "Contract" ADD COLUMN     "businessLine" "BusinessLine" NOT NULL DEFAULT 'GUARDING';

-- AlterTable
ALTER TABLE "PayrollAllocation" ADD COLUMN     "businessCosts" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PayrollRecord" ADD COLUMN     "businessLine" TEXT NOT NULL DEFAULT 'BACK_OFFICE',
ADD COLUMN     "insuranceAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "itfAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "leaveRelieverAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "nhfMedicalAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "nsitfAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "outsourcingLeaveAllowanceAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "recruitmentTrainingAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "totalEmployerAddOns" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "uniformKitsAmount" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PayrollRun" ADD COLUMN     "totalEmployerAddOns" DECIMAL(16,2) NOT NULL DEFAULT 0,
ADD COLUMN     "totalInsurance" DECIMAL(16,2) NOT NULL DEFAULT 0,
ADD COLUMN     "totalItf" DECIMAL(16,2) NOT NULL DEFAULT 0,
ADD COLUMN     "totalLeaveReliever" DECIMAL(16,2) NOT NULL DEFAULT 0,
ADD COLUMN     "totalNhfMedical" DECIMAL(16,2) NOT NULL DEFAULT 0,
ADD COLUMN     "totalNsitf" DECIMAL(16,2) NOT NULL DEFAULT 0,
ADD COLUMN     "totalOutsourcingLeaveAllowance" DECIMAL(16,2) NOT NULL DEFAULT 0,
ADD COLUMN     "totalRecruitmentTraining" DECIMAL(16,2) NOT NULL DEFAULT 0,
ADD COLUMN     "totalUniformKits" DECIMAL(16,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "EmployerCostRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "itfPct" DECIMAL(5,2) NOT NULL DEFAULT 1,
    "nsitfPct" DECIMAL(5,2) NOT NULL DEFAULT 1,
    "nhfMedicalPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "insurancePct" DECIMAL(5,2) NOT NULL DEFAULT 7.5,
    "uniformKitsPct" DECIMAL(5,2) NOT NULL DEFAULT 25,
    "recruitmentTrainingPct" DECIMAL(5,2) NOT NULL DEFAULT 10.5,
    "leaveRelieverPct" DECIMAL(5,2) NOT NULL DEFAULT 22,
    "outsourcingLeaveAllowancePct" DECIMAL(5,2) NOT NULL DEFAULT 20,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployerCostRule_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "EmployerCostRule" ADD CONSTRAINT "EmployerCostRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
