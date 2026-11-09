-- Performance management, step (b): the performance improvement plan (the founder, 2026-11-07; plan: docs/plans/performance-improvement-plan.md).
-- Additive only: three enums, four new tables (plans, objectives, reviews, one result per objective per review) and five settings columns on the HR policy with their proposed defaults
-- (60 days, longest 90, one extension of at most 30 days, a review every 14 days). Nothing existing changes meaning and no existing row is rewritten.

-- CreateEnum
CREATE TYPE "PipStatus" AS ENUM ('DRAFT', 'AWAITING_APPROVAL', 'ACTIVE', 'OUTCOME_PROPOSED', 'CLOSED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "PipOutcome" AS ENUM ('SUCCESSFUL', 'EXTENDED', 'UNSUCCESSFUL');

-- CreateEnum
CREATE TYPE "PipObjectiveResult" AS ENUM ('OPEN', 'MET', 'PARTLY_MET', 'NOT_MET');

-- AlterTable
ALTER TABLE "HrPolicy" ADD COLUMN     "pipDefaultDays" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "pipMaxDays" INTEGER NOT NULL DEFAULT 90,
ADD COLUMN     "pipMaxExtensionDays" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "pipMaxExtensions" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "pipReviewIntervalDays" INTEGER NOT NULL DEFAULT 14;

-- CreateTable
CREATE TABLE "PerformanceImprovementPlan" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "appraisalId" TEXT,
    "status" "PipStatus" NOT NULL DEFAULT 'DRAFT',
    "concerns" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "originalEndDate" DATE NOT NULL,
    "extensionsUsed" INTEGER NOT NULL DEFAULT 0,
    "ownerUserId" TEXT NOT NULL,
    "ownerName" TEXT NOT NULL,
    "draftedByUserId" TEXT NOT NULL,
    "draftedBy" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "activatedByUserId" TEXT,
    "activatedBy" TEXT,
    "activationNote" TEXT,
    "returnNote" TEXT,
    "nextReviewDue" DATE,
    "proposedOutcome" "PipOutcome",
    "proposedEndDate" DATE,
    "proposedNote" TEXT,
    "proposedByUserId" TEXT,
    "proposedBy" TEXT,
    "proposedAt" TIMESTAMP(3),
    "outcome" "PipOutcome",
    "outcomeNote" TEXT,
    "outcomeApprovedByUserId" TEXT,
    "outcomeApprovedBy" TEXT,
    "closedAt" TIMESTAMP(3),
    "withdrawnAt" TIMESTAMP(3),
    "withdrawnBy" TEXT,
    "withdrawReason" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "employeeAgreed" BOOLEAN,
    "employeeResponse" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PerformanceImprovementPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipObjective" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "gap" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "support" TEXT,
    "dueDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PipObjective_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipReview" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "reviewedOn" DATE NOT NULL,
    "summary" TEXT NOT NULL,
    "recordedByUserId" TEXT NOT NULL,
    "recordedBy" TEXT NOT NULL,
    "employeeComment" TEXT,
    "employeeCommentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PipReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipReviewAssessment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "objectiveId" TEXT NOT NULL,
    "result" "PipObjectiveResult" NOT NULL,
    "note" TEXT,

    CONSTRAINT "PipReviewAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PerformanceImprovementPlan_organizationId_status_idx" ON "PerformanceImprovementPlan"("organizationId", "status");

-- CreateIndex
CREATE INDEX "PerformanceImprovementPlan_organizationId_employeeId_idx" ON "PerformanceImprovementPlan"("organizationId", "employeeId");

-- CreateIndex
CREATE INDEX "PerformanceImprovementPlan_ownerUserId_idx" ON "PerformanceImprovementPlan"("ownerUserId");

-- CreateIndex
CREATE INDEX "PipObjective_planId_idx" ON "PipObjective"("planId");

-- CreateIndex
CREATE INDEX "PipReview_planId_reviewedOn_idx" ON "PipReview"("planId", "reviewedOn");

-- CreateIndex
CREATE INDEX "PipReviewAssessment_objectiveId_idx" ON "PipReviewAssessment"("objectiveId");

-- CreateIndex
CREATE UNIQUE INDEX "PipReviewAssessment_reviewId_objectiveId_key" ON "PipReviewAssessment"("reviewId", "objectiveId");

-- AddForeignKey
ALTER TABLE "PerformanceImprovementPlan" ADD CONSTRAINT "PerformanceImprovementPlan_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceImprovementPlan" ADD CONSTRAINT "PerformanceImprovementPlan_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceImprovementPlan" ADD CONSTRAINT "PerformanceImprovementPlan_appraisalId_fkey" FOREIGN KEY ("appraisalId") REFERENCES "Appraisal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipObjective" ADD CONSTRAINT "PipObjective_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipObjective" ADD CONSTRAINT "PipObjective_planId_fkey" FOREIGN KEY ("planId") REFERENCES "PerformanceImprovementPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipReview" ADD CONSTRAINT "PipReview_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipReview" ADD CONSTRAINT "PipReview_planId_fkey" FOREIGN KEY ("planId") REFERENCES "PerformanceImprovementPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipReviewAssessment" ADD CONSTRAINT "PipReviewAssessment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipReviewAssessment" ADD CONSTRAINT "PipReviewAssessment_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "PipReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipReviewAssessment" ADD CONSTRAINT "PipReviewAssessment_objectiveId_fkey" FOREIGN KEY ("objectiveId") REFERENCES "PipObjective"("id") ON DELETE CASCADE ON UPDATE CASCADE;

