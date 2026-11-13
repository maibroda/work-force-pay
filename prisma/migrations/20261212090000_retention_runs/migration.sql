-- CreateEnum
CREATE TYPE "RetentionRunStatus" AS ENUM ('PROPOSED', 'EXECUTED', 'REJECTED');

-- CreateTable
CREATE TABLE "RetentionRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "category" "RetentionCategory" NOT NULL,
    "status" "RetentionRunStatus" NOT NULL DEFAULT 'PROPOSED',
    "periodMonths" INTEGER NOT NULL,
    "trigger" "RetentionTrigger" NOT NULL,
    "action" "RetentionAction" NOT NULL,
    "ruleVerified" BOOLEAN NOT NULL DEFAULT false,
    "itemCount" INTEGER NOT NULL,
    "skippedHeld" INTEGER NOT NULL DEFAULT 0,
    "skippedOpen" INTEGER NOT NULL DEFAULT 0,
    "proposedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "proposedByUserId" TEXT NOT NULL,
    "proposedBy" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3),
    "decidedByUserId" TEXT,
    "decidedBy" TEXT,
    "decisionNote" TEXT,
    "acceptedUnverified" BOOLEAN NOT NULL DEFAULT false,
    "singleHolder" BOOLEAN NOT NULL DEFAULT false,
    "clearedItems" INTEGER,
    "skippedAtConfirm" INTEGER,
    "summary" JSONB,

    CONSTRAINT "RetentionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetentionRunItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "category" "RetentionCategory" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "employeeId" TEXT,
    "clearedAt" TIMESTAMP(3),
    "skippedReason" TEXT,

    CONSTRAINT "RetentionRunItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RetentionRun_organizationId_status_idx" ON "RetentionRun"("organizationId", "status");

-- CreateIndex
CREATE INDEX "RetentionRun_organizationId_category_idx" ON "RetentionRun"("organizationId", "category");

-- CreateIndex
CREATE INDEX "RetentionRunItem_organizationId_category_clearedAt_idx" ON "RetentionRunItem"("organizationId", "category", "clearedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RetentionRunItem_runId_subjectId_key" ON "RetentionRunItem"("runId", "subjectId");

-- AddForeignKey
ALTER TABLE "RetentionRun" ADD CONSTRAINT "RetentionRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetentionRunItem" ADD CONSTRAINT "RetentionRunItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetentionRunItem" ADD CONSTRAINT "RetentionRunItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "RetentionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

