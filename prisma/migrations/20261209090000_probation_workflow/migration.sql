-- CreateEnum
CREATE TYPE "ProbationRecommendation" AS ENUM ('CONFIRM', 'EXTEND', 'NOT_CONFIRM');

-- CreateEnum
CREATE TYPE "ProbationReviewStatus" AS ENUM ('RECOMMENDED', 'RETURNED', 'FORWARDED', 'DECIDED');

-- AlterTable
ALTER TABLE "HrPolicy" ADD COLUMN     "probationResponseDays" INTEGER NOT NULL DEFAULT 7,
ADD COLUMN     "probationWorkflow" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ProbationDecision" ADD COLUMN     "reviewId" TEXT;

-- CreateTable
CREATE TABLE "ProbationReview" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "status" "ProbationReviewStatus" NOT NULL DEFAULT 'RECOMMENDED',
    "recommendation" "ProbationRecommendation" NOT NULL,
    "recommendedMonths" INTEGER,
    "recommendationNote" TEXT NOT NULL,
    "recommendedByUserId" TEXT NOT NULL,
    "recommendedBy" TEXT NOT NULL,
    "recommendedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedByHr" BOOLEAN NOT NULL DEFAULT false,
    "reviewNote" TEXT,
    "reviewedByUserId" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "appraisalSignedOff" BOOLEAN,
    "minScoreMet" BOOLEAN,
    "withinMaxMonths" BOOLEAN,
    "decidedAt" TIMESTAMP(3),
    "decidedAgainstRecommendation" BOOLEAN NOT NULL DEFAULT false,
    "feedbackText" TEXT,
    "feedbackByUserId" TEXT,
    "feedbackAt" TIMESTAMP(3),
    "responseAgreed" BOOLEAN,
    "responseText" TEXT,
    "respondedAt" TIMESTAMP(3),
    "responseReadByUserId" TEXT,
    "responseReadBy" TEXT,
    "responseReadAt" TIMESTAMP(3),

    CONSTRAINT "ProbationReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProbationDecider" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "departmentId" TEXT,
    "reason" TEXT NOT NULL,
    "grantedByUserId" TEXT NOT NULL,
    "grantedBy" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,
    "revokedBy" TEXT,
    "revokeReason" TEXT,

    CONSTRAINT "ProbationDecider_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProbationReview_organizationId_status_idx" ON "ProbationReview"("organizationId", "status");

-- CreateIndex
CREATE INDEX "ProbationReview_organizationId_employeeId_idx" ON "ProbationReview"("organizationId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "ProbationReview_contractId_round_key" ON "ProbationReview"("contractId", "round");

-- CreateIndex
CREATE INDEX "ProbationDecider_organizationId_userId_idx" ON "ProbationDecider"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProbationDecision_reviewId_key" ON "ProbationDecision"("reviewId");

-- AddForeignKey
ALTER TABLE "ProbationDecision" ADD CONSTRAINT "ProbationDecision_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "ProbationReview"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProbationReview" ADD CONSTRAINT "ProbationReview_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProbationReview" ADD CONSTRAINT "ProbationReview_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProbationReview" ADD CONSTRAINT "ProbationReview_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "EmploymentContract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProbationDecider" ADD CONSTRAINT "ProbationDecider_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProbationDecider" ADD CONSTRAINT "ProbationDecider_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProbationDecider" ADD CONSTRAINT "ProbationDecider_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

