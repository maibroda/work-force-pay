-- CreateEnum
CREATE TYPE "TrainingRequestStatus" AS ENUM ('REQUESTED', 'ACCEPTED', 'DECLINED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "TrainingEvaluationKind" AS ENUM ('PARTICIPANT', 'MANAGER');

-- AlterTable
ALTER TABLE "HrPolicy" ADD COLUMN     "trainingEvaluationDays" INTEGER NOT NULL DEFAULT 60;

-- CreateTable
CREATE TABLE "TrainingRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "courseName" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "TrainingRequestStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedByUserId" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedByUserId" TEXT,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "withdrawReason" TEXT,
    "needId" TEXT,

    CONSTRAINT "TrainingRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingEvaluation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "enrolmentId" TEXT NOT NULL,
    "kind" "TrainingEvaluationKind" NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "byUserId" TEXT NOT NULL,
    "byName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainingEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrainingRequest_needId_key" ON "TrainingRequest"("needId");

-- CreateIndex
CREATE INDEX "TrainingRequest_organizationId_status_idx" ON "TrainingRequest"("organizationId", "status");

-- CreateIndex
CREATE INDEX "TrainingRequest_organizationId_employeeId_idx" ON "TrainingRequest"("organizationId", "employeeId");

-- CreateIndex
CREATE INDEX "TrainingEvaluation_organizationId_kind_idx" ON "TrainingEvaluation"("organizationId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingEvaluation_enrolmentId_kind_key" ON "TrainingEvaluation"("enrolmentId", "kind");

-- AddForeignKey
ALTER TABLE "TrainingRequest" ADD CONSTRAINT "TrainingRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingRequest" ADD CONSTRAINT "TrainingRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingRequest" ADD CONSTRAINT "TrainingRequest_needId_fkey" FOREIGN KEY ("needId") REFERENCES "TrainingNeed"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingEvaluation" ADD CONSTRAINT "TrainingEvaluation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingEvaluation" ADD CONSTRAINT "TrainingEvaluation_enrolmentId_fkey" FOREIGN KEY ("enrolmentId") REFERENCES "TrainingEnrolment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

