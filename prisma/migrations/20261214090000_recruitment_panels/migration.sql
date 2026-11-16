-- CreateEnum
CREATE TYPE "SelectionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "Interview" ADD COLUMN     "panelClosedAt" TIMESTAMP(3),
ADD COLUMN     "panelClosedBy" TEXT;

-- CreateTable
CREATE TABLE "InterviewPanelMember" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "interviewId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "isChair" BOOLEAN NOT NULL DEFAULT false,
    "submittedAt" TIMESTAMP(3),
    "recommendation" "InterviewRecommendation",
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InterviewPanelMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequisitionCriterion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requisitionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequisitionCriterion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScorecardScore" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "panelMemberId" TEXT NOT NULL,
    "criterionId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "comment" TEXT,

    CONSTRAINT "ScorecardScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateSelection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "status" "SelectionStatus" NOT NULL DEFAULT 'PENDING',
    "recommendedById" TEXT NOT NULL,
    "recommendedBy" TEXT NOT NULL,
    "recommendedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT NOT NULL,
    "decidedById" TEXT,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,

    CONSTRAINT "CandidateSelection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InterviewPanelMember_organizationId_employeeId_idx" ON "InterviewPanelMember"("organizationId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "InterviewPanelMember_interviewId_employeeId_key" ON "InterviewPanelMember"("interviewId", "employeeId");

-- CreateIndex
CREATE INDEX "RequisitionCriterion_organizationId_requisitionId_idx" ON "RequisitionCriterion"("organizationId", "requisitionId");

-- CreateIndex
CREATE UNIQUE INDEX "RequisitionCriterion_requisitionId_position_key" ON "RequisitionCriterion"("requisitionId", "position");

-- CreateIndex
CREATE INDEX "ScorecardScore_organizationId_criterionId_idx" ON "ScorecardScore"("organizationId", "criterionId");

-- CreateIndex
CREATE UNIQUE INDEX "ScorecardScore_panelMemberId_criterionId_key" ON "ScorecardScore"("panelMemberId", "criterionId");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateSelection_candidateId_key" ON "CandidateSelection"("candidateId");

-- CreateIndex
CREATE INDEX "CandidateSelection_organizationId_status_idx" ON "CandidateSelection"("organizationId", "status");

-- AddForeignKey
ALTER TABLE "InterviewPanelMember" ADD CONSTRAINT "InterviewPanelMember_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewPanelMember" ADD CONSTRAINT "InterviewPanelMember_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewPanelMember" ADD CONSTRAINT "InterviewPanelMember_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequisitionCriterion" ADD CONSTRAINT "RequisitionCriterion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequisitionCriterion" ADD CONSTRAINT "RequisitionCriterion_requisitionId_fkey" FOREIGN KEY ("requisitionId") REFERENCES "JobRequisition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScorecardScore" ADD CONSTRAINT "ScorecardScore_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScorecardScore" ADD CONSTRAINT "ScorecardScore_panelMemberId_fkey" FOREIGN KEY ("panelMemberId") REFERENCES "InterviewPanelMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScorecardScore" ADD CONSTRAINT "ScorecardScore_criterionId_fkey" FOREIGN KEY ("criterionId") REFERENCES "RequisitionCriterion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateSelection" ADD CONSTRAINT "CandidateSelection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateSelection" ADD CONSTRAINT "CandidateSelection_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

