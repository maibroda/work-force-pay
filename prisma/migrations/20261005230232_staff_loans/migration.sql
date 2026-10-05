-- CreateEnum
CREATE TYPE "LoanType" AS ENUM ('LOAN', 'SALARY_ADVANCE');

-- CreateEnum
CREATE TYPE "LoanStatus" AS ENUM ('PENDING_APPROVAL', 'ACTIVE', 'REJECTED', 'CANCELLED', 'WRITTEN_OFF');

-- CreateEnum
CREATE TYPE "LoanInstallmentKind" AS ENUM ('PAYROLL', 'SETTLEMENT', 'CASH');

-- AlterTable
ALTER TABLE "ExitSettlementLine" ADD COLUMN     "loanId" TEXT;

-- AlterTable
ALTER TABLE "HrPolicy" ADD COLUMN     "advanceMaxGrossPct" INTEGER NOT NULL DEFAULT 50,
ADD COLUMN     "loanMaxDeductionPct" INTEGER NOT NULL DEFAULT 33,
ADD COLUMN     "loanMaxGrossMultiple" DECIMAL(4,2) NOT NULL DEFAULT 3;

-- CreateTable
CREATE TABLE "StaffLoan" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "loanNumber" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "type" "LoanType" NOT NULL DEFAULT 'LOAN',
    "principal" DECIMAL(14,2) NOT NULL,
    "installmentCount" INTEGER NOT NULL DEFAULT 1,
    "installmentAmount" DECIMAL(14,2) NOT NULL,
    "firstDeductionYear" INTEGER NOT NULL,
    "firstDeductionMonth" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "LoanStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "requestedBy" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "disbursedOn" DATE,
    "writtenOffAmount" DECIMAL(14,2),
    "writtenOffReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffLoan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoanInstallment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "kind" "LoanInstallmentKind" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "deductionId" TEXT,
    "periodId" TEXT,
    "paidOn" DATE,
    "reference" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoanInstallment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StaffLoan_organizationId_employeeId_idx" ON "StaffLoan"("organizationId", "employeeId");

-- CreateIndex
CREATE INDEX "StaffLoan_organizationId_status_idx" ON "StaffLoan"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "StaffLoan_organizationId_loanNumber_key" ON "StaffLoan"("organizationId", "loanNumber");

-- CreateIndex
CREATE UNIQUE INDEX "LoanInstallment_deductionId_key" ON "LoanInstallment"("deductionId");

-- CreateIndex
CREATE INDEX "LoanInstallment_organizationId_loanId_idx" ON "LoanInstallment"("organizationId", "loanId");

-- AddForeignKey
ALTER TABLE "StaffLoan" ADD CONSTRAINT "StaffLoan_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffLoan" ADD CONSTRAINT "StaffLoan_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanInstallment" ADD CONSTRAINT "LoanInstallment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanInstallment" ADD CONSTRAINT "LoanInstallment_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "StaffLoan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

