-- CreateEnum
CREATE TYPE "ReconsiderationStatus" AS ENUM ('REQUESTED', 'RETURNED', 'FORWARDED', 'APPROVED', 'DECLINED', 'EFFECTIVE', 'WITHDRAWN');

-- AlterTable
ALTER TABLE "HrPolicy" ADD COLUMN     "probationCeilingMonths" INTEGER NOT NULL DEFAULT 9,
ADD COLUMN     "reconsiderationEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reconsiderationMax" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "reconsiderationMinExpectations" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "reconsiderationMinJustification" INTEGER NOT NULL DEFAULT 50,
ADD COLUMN     "reconsiderationWindowDays" INTEGER NOT NULL DEFAULT 14;

-- CreateTable
CREATE TABLE "ProbationReconsideration" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "failedDecisionId" TEXT NOT NULL,
    "status" "ReconsiderationStatus" NOT NULL DEFAULT 'REQUESTED',
    "justification" TEXT NOT NULL,
    "proposedMonths" INTEGER NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedByHr" BOOLEAN NOT NULL DEFAULT false,
    "hrNote" TEXT,
    "hrByUserId" TEXT,
    "hrBy" TEXT,
    "hrAt" TIMESTAMP(3),
    "approvedMonths" INTEGER,
    "decisionNote" TEXT,
    "decidedByUserId" TEXT,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "withdrawnByUserId" TEXT,
    "withdrawnBy" TEXT,
    "withdrawnAt" TIMESTAMP(3),
    "withdrawReason" TEXT,
    "statement" TEXT,
    "communicatedByUserId" TEXT,
    "communicatedBy" TEXT,
    "communicatedAt" TIMESTAMP(3),
    "newEndDate" DATE,
    "extensionDecisionId" TEXT,
    "responseAgreed" BOOLEAN,
    "responseText" TEXT,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "ProbationReconsideration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProbationExpectation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "reconsiderationId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "measure" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "reviewOn" DATE NOT NULL,

    CONSTRAINT "ProbationExpectation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProbationReconsideration_extensionDecisionId_key" ON "ProbationReconsideration"("extensionDecisionId");

-- CreateIndex
CREATE INDEX "ProbationReconsideration_organizationId_status_idx" ON "ProbationReconsideration"("organizationId", "status");

-- CreateIndex
CREATE INDEX "ProbationReconsideration_contractId_idx" ON "ProbationReconsideration"("contractId");

-- CreateIndex
CREATE INDEX "ProbationReconsideration_organizationId_employeeId_idx" ON "ProbationReconsideration"("organizationId", "employeeId");

-- CreateIndex
CREATE INDEX "ProbationExpectation_reconsiderationId_idx" ON "ProbationExpectation"("reconsiderationId");

-- AddForeignKey
ALTER TABLE "ProbationReconsideration" ADD CONSTRAINT "ProbationReconsideration_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProbationReconsideration" ADD CONSTRAINT "ProbationReconsideration_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProbationReconsideration" ADD CONSTRAINT "ProbationReconsideration_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "EmploymentContract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProbationExpectation" ADD CONSTRAINT "ProbationExpectation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProbationExpectation" ADD CONSTRAINT "ProbationExpectation_reconsiderationId_fkey" FOREIGN KEY ("reconsiderationId") REFERENCES "ProbationReconsideration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

