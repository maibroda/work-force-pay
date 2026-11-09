-- Performance management, step (d): the probation review decision record (the founder, 2026-11-09; plan: docs/plans/probation-review-plan.md).
-- Additive only: one new table (an append-only record of each confirm, extend or fail decision, with a snapshot of the supporting appraisal) and one HR policy column
-- (days past the end of an undecided probation before it is escalated, default 7, 0 = never). The contract keeps its current outcome exactly as before.

-- AlterTable
ALTER TABLE "HrPolicy" ADD COLUMN     "probationEscalationDays" INTEGER NOT NULL DEFAULT 7;

-- CreateTable
CREATE TABLE "ProbationDecision" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "decision" "ProbationOutcome" NOT NULL,
    "decidedByUserId" TEXT NOT NULL,
    "decidedBy" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "extensionMonths" INTEGER,
    "effectiveDate" DATE,
    "appraisalId" TEXT,
    "appraisalScore" INTEGER,
    "appraisalRecommendation" "AppraisalRecommendation",
    "againstRecommendation" BOOLEAN NOT NULL DEFAULT false,
    "informedAt" TIMESTAMP(3),
    "informedBy" TEXT,

    CONSTRAINT "ProbationDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProbationDecision_organizationId_employeeId_idx" ON "ProbationDecision"("organizationId", "employeeId");

-- CreateIndex
CREATE INDEX "ProbationDecision_contractId_decidedAt_idx" ON "ProbationDecision"("contractId", "decidedAt");

-- AddForeignKey
ALTER TABLE "ProbationDecision" ADD CONSTRAINT "ProbationDecision_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProbationDecision" ADD CONSTRAINT "ProbationDecision_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProbationDecision" ADD CONSTRAINT "ProbationDecision_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "EmploymentContract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

