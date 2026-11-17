-- CreateEnum
CREATE TYPE "ScreeningKind" AS ENUM ('MUST_HAVE', 'PREFERRED');

-- CreateEnum
CREATE TYPE "ScreeningOutcome" AS ENUM ('MET', 'NOT_MET', 'UNCLEAR');

-- CreateEnum
CREATE TYPE "ShortlistDecision" AS ENUM ('SHORTLISTED', 'NOT_SHORTLISTED');

-- CreateTable
CREATE TABLE "ScreeningCriterion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requisitionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "ScreeningKind" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScreeningCriterion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateScreening" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "criterionId" TEXT NOT NULL,
    "outcome" "ScreeningOutcome" NOT NULL,
    "evidence" TEXT,
    "recordedById" TEXT NOT NULL,
    "recordedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidateScreening_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateShortlist" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "decision" "ShortlistDecision" NOT NULL,
    "reason" TEXT NOT NULL,
    "decidedById" TEXT NOT NULL,
    "decidedBy" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CandidateShortlist_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScreeningCriterion_organizationId_requisitionId_idx" ON "ScreeningCriterion"("organizationId", "requisitionId");

-- CreateIndex
CREATE UNIQUE INDEX "ScreeningCriterion_requisitionId_position_key" ON "ScreeningCriterion"("requisitionId", "position");

-- CreateIndex
CREATE INDEX "CandidateScreening_organizationId_candidateId_idx" ON "CandidateScreening"("organizationId", "candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateScreening_candidateId_criterionId_key" ON "CandidateScreening"("candidateId", "criterionId");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateShortlist_candidateId_key" ON "CandidateShortlist"("candidateId");

-- CreateIndex
CREATE INDEX "CandidateShortlist_organizationId_decision_idx" ON "CandidateShortlist"("organizationId", "decision");

-- AddForeignKey
ALTER TABLE "ScreeningCriterion" ADD CONSTRAINT "ScreeningCriterion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreeningCriterion" ADD CONSTRAINT "ScreeningCriterion_requisitionId_fkey" FOREIGN KEY ("requisitionId") REFERENCES "JobRequisition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateScreening" ADD CONSTRAINT "CandidateScreening_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateScreening" ADD CONSTRAINT "CandidateScreening_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateScreening" ADD CONSTRAINT "CandidateScreening_criterionId_fkey" FOREIGN KEY ("criterionId") REFERENCES "ScreeningCriterion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateShortlist" ADD CONSTRAINT "CandidateShortlist_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateShortlist" ADD CONSTRAINT "CandidateShortlist_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

