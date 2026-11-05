-- The founder's decision (2026-11-05): a personal monthly gross is PROPOSED by HR or payroll and APPROVED by a payroll manager, a second person, before it becomes a pay rate.
-- A new table and its status. A proposal is not a pay rate: the pay run reads only EmployeePayRate, which is unchanged. Nothing existing is altered or lost.

-- CreateEnum
CREATE TYPE "PayRateProposalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "PayRateProposal" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "monthlyGross" DECIMAL(14,2) NOT NULL,
    "structureCode" TEXT,
    "effectiveFrom" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "status" "PayRateProposalStatus" NOT NULL DEFAULT 'PENDING',
    "proposedBy" TEXT NOT NULL,
    "proposedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedBy" TEXT,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "appliedRateId" TEXT,

    CONSTRAINT "PayRateProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PayRateProposal_organizationId_status_idx" ON "PayRateProposal"("organizationId", "status");

-- CreateIndex
CREATE INDEX "PayRateProposal_organizationId_employeeId_idx" ON "PayRateProposal"("organizationId", "employeeId");

-- AddForeignKey
ALTER TABLE "PayRateProposal" ADD CONSTRAINT "PayRateProposal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayRateProposal" ADD CONSTRAINT "PayRateProposal_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
