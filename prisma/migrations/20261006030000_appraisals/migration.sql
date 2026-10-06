-- CreateEnum
CREATE TYPE "AppraisalKind" AS ENUM ('ANNUAL', 'PROBATION', 'AD_HOC');

-- CreateEnum
CREATE TYPE "AppraisalCycleStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "AppraisalStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'ACKNOWLEDGED');

-- CreateEnum
CREATE TYPE "AppraisalRecommendation" AS ENUM ('NONE', 'CONFIRM_EMPLOYMENT', 'INCREMENT', 'PROMOTION', 'TRAINING', 'PERFORMANCE_PLAN');

-- AlterTable
ALTER TABLE "HrPolicy" ADD COLUMN     "appraisalCommentAtOrAbove" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "appraisalCommentAtOrBelow" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "appraisalMinServiceDays" INTEGER NOT NULL DEFAULT 90,
ADD COLUMN     "appraisalSelfAssessment" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "AppraisalCriterion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "weight" INTEGER NOT NULL DEFAULT 10,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppraisalCriterion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppraisalCycle" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "AppraisalKind" NOT NULL DEFAULT 'ANNUAL',
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "status" "AppraisalCycleStatus" NOT NULL DEFAULT 'OPEN',
    "createdBy" TEXT NOT NULL,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppraisalCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appraisal" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "reviewerUserId" TEXT,
    "reviewerName" TEXT,
    "status" "AppraisalStatus" NOT NULL DEFAULT 'DRAFT',
    "selfSubmittedAt" TIMESTAMP(3),
    "employeeSelfComment" TEXT,
    "overallScore" DECIMAL(4,2),
    "overallBand" TEXT,
    "strengths" TEXT,
    "improvements" TEXT,
    "goals" TEXT,
    "reviewerComment" TEXT,
    "recommendation" "AppraisalRecommendation" NOT NULL DEFAULT 'NONE',
    "submittedAt" TIMESTAMP(3),
    "returnNote" TEXT,
    "approvedBy" TEXT,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvalNote" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "employeeAgreed" BOOLEAN,
    "employeeResponse" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Appraisal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppraisalRating" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "appraisalId" TEXT NOT NULL,
    "criterionId" TEXT NOT NULL,
    "criterionName" TEXT NOT NULL,
    "weight" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "selfRating" INTEGER,
    "selfComment" TEXT,
    "rating" INTEGER,
    "comment" TEXT,

    CONSTRAINT "AppraisalRating_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AppraisalCriterion_organizationId_active_idx" ON "AppraisalCriterion"("organizationId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "AppraisalCriterion_organizationId_name_key" ON "AppraisalCriterion"("organizationId", "name");

-- CreateIndex
CREATE INDEX "AppraisalCycle_organizationId_status_idx" ON "AppraisalCycle"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AppraisalCycle_organizationId_name_key" ON "AppraisalCycle"("organizationId", "name");

-- CreateIndex
CREATE INDEX "Appraisal_organizationId_status_idx" ON "Appraisal"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Appraisal_organizationId_employeeId_idx" ON "Appraisal"("organizationId", "employeeId");

-- CreateIndex
CREATE INDEX "Appraisal_reviewerUserId_idx" ON "Appraisal"("reviewerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Appraisal_cycleId_employeeId_key" ON "Appraisal"("cycleId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "AppraisalRating_appraisalId_criterionId_key" ON "AppraisalRating"("appraisalId", "criterionId");

-- AddForeignKey
ALTER TABLE "AppraisalCriterion" ADD CONSTRAINT "AppraisalCriterion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppraisalCycle" ADD CONSTRAINT "AppraisalCycle_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appraisal" ADD CONSTRAINT "Appraisal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appraisal" ADD CONSTRAINT "Appraisal_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "AppraisalCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appraisal" ADD CONSTRAINT "Appraisal_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppraisalRating" ADD CONSTRAINT "AppraisalRating_appraisalId_fkey" FOREIGN KEY ("appraisalId") REFERENCES "Appraisal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppraisalRating" ADD CONSTRAINT "AppraisalRating_criterionId_fkey" FOREIGN KEY ("criterionId") REFERENCES "AppraisalCriterion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

