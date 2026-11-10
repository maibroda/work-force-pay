-- CreateEnum
CREATE TYPE "PromotionStatus" AS ENUM ('PROPOSED', 'APPROVED', 'DECLINED', 'WITHDRAWN', 'APPLIED');

-- CreateEnum
CREATE TYPE "SuccessionReadiness" AS ENUM ('READY_NOW', 'READY_1_2_YEARS', 'READY_3_PLUS');

-- AlterTable
ALTER TABLE "HrPolicy" ADD COLUMN     "promotionApplyAlertDays" INTEGER NOT NULL DEFAULT 14;

-- CreateTable
CREATE TABLE "CareerPath" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fromCategoryId" TEXT NOT NULL,
    "toCategoryId" TEXT NOT NULL,
    "minMonths" INTEGER,
    "requiredCourse" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CareerPath_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromotionProposal" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "fromCategoryId" TEXT NOT NULL,
    "toCategoryId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "intendedOn" DATE NOT NULL,
    "status" "PromotionStatus" NOT NULL DEFAULT 'PROPOSED',
    "warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "proposedByUserId" TEXT NOT NULL,
    "proposedBy" TEXT NOT NULL,
    "proposedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedByUserId" TEXT,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "withdrawnByUserId" TEXT,
    "withdrawnBy" TEXT,
    "withdrawnAt" TIMESTAMP(3),
    "withdrawReason" TEXT,
    "appliedByUserId" TEXT,
    "appliedBy" TEXT,
    "appliedAt" TIMESTAMP(3),

    CONSTRAINT "PromotionProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuccessionRole" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SuccessionRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuccessionCandidate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "readiness" "SuccessionReadiness" NOT NULL,
    "reason" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SuccessionCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CareerPath_organizationId_active_idx" ON "CareerPath"("organizationId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "CareerPath_organizationId_fromCategoryId_toCategoryId_key" ON "CareerPath"("organizationId", "fromCategoryId", "toCategoryId");

-- CreateIndex
CREATE INDEX "PromotionProposal_organizationId_status_idx" ON "PromotionProposal"("organizationId", "status");

-- CreateIndex
CREATE INDEX "PromotionProposal_organizationId_employeeId_idx" ON "PromotionProposal"("organizationId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "SuccessionRole_organizationId_categoryId_key" ON "SuccessionRole"("organizationId", "categoryId");

-- CreateIndex
CREATE INDEX "SuccessionCandidate_organizationId_employeeId_idx" ON "SuccessionCandidate"("organizationId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "SuccessionCandidate_roleId_employeeId_key" ON "SuccessionCandidate"("roleId", "employeeId");

-- AddForeignKey
ALTER TABLE "CareerPath" ADD CONSTRAINT "CareerPath_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerPath" ADD CONSTRAINT "CareerPath_fromCategoryId_fkey" FOREIGN KEY ("fromCategoryId") REFERENCES "EmployeeCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerPath" ADD CONSTRAINT "CareerPath_toCategoryId_fkey" FOREIGN KEY ("toCategoryId") REFERENCES "EmployeeCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionProposal" ADD CONSTRAINT "PromotionProposal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionProposal" ADD CONSTRAINT "PromotionProposal_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionProposal" ADD CONSTRAINT "PromotionProposal_fromCategoryId_fkey" FOREIGN KEY ("fromCategoryId") REFERENCES "EmployeeCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionProposal" ADD CONSTRAINT "PromotionProposal_toCategoryId_fkey" FOREIGN KEY ("toCategoryId") REFERENCES "EmployeeCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuccessionRole" ADD CONSTRAINT "SuccessionRole_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuccessionRole" ADD CONSTRAINT "SuccessionRole_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "EmployeeCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuccessionCandidate" ADD CONSTRAINT "SuccessionCandidate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuccessionCandidate" ADD CONSTRAINT "SuccessionCandidate_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "SuccessionRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuccessionCandidate" ADD CONSTRAINT "SuccessionCandidate_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

