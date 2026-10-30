-- Sales Phase 6 (docs/crm/06-phase-6-plan.md): automation rules, the record of each time one ran, and in-app notifications.
-- New tables only (nothing existing is changed). The database allows one run for each rule, deal and entry, so a rule never fires twice for the same entry.
-- To reverse, run down.sql in this folder (Prisma runs only migration.sql).

-- CreateEnum
CREATE TYPE "CrmAutomationTrigger" AS ENUM ('STAGE_ENTRY', 'QUOTE_ACCEPTED', 'HANDOVER_ACCEPTED', 'NO_ACTIVITY');

-- CreateEnum
CREATE TYPE "CrmAutomationAction" AS ENUM ('CREATE_TASK', 'NOTIFY', 'SEND_EMAIL', 'CHANGE_OWNER', 'SET_FIELD', 'CREATE_FOLLOW_UP', 'MOVE_TO_STAGE');

-- CreateEnum
CREATE TYPE "CrmAutomationRunStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED', 'CANCELLED', 'SKIPPED');

-- CreateTable
CREATE TABLE "CrmAutomationRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trigger" "CrmAutomationTrigger" NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "stageId" TEXT,
    "delayMinutes" INTEGER NOT NULL DEFAULT 0,
    "quietDays" INTEGER,
    "condition" JSONB,
    "actionType" "CrmAutomationAction" NOT NULL,
    "actionParams" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "isStarter" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

CONSTRAINT "CrmAutomationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmAutomationRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "entryKey" TEXT NOT NULL,
    "status" "CrmAutomationRunStatus" NOT NULL DEFAULT 'PENDING',
    "runAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "inputs" JSONB,
    "outputs" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "CrmAutomationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmNotification" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "href" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

CONSTRAINT "CrmNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CrmAutomationRule_organizationId_trigger_enabled_idx" ON "CrmAutomationRule"("organizationId", "trigger", "enabled");

-- CreateIndex
CREATE INDEX "CrmAutomationRun_organizationId_status_runAt_idx" ON "CrmAutomationRun"("organizationId", "status", "runAt");

-- CreateIndex
CREATE INDEX "CrmAutomationRun_organizationId_createdAt_idx" ON "CrmAutomationRun"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CrmAutomationRun_ruleId_opportunityId_entryKey_key" ON "CrmAutomationRun"("ruleId", "opportunityId", "entryKey");

-- CreateIndex
CREATE INDEX "CrmNotification_organizationId_userId_readAt_idx" ON "CrmNotification"("organizationId", "userId", "readAt");

-- AddForeignKey
ALTER TABLE "CrmAutomationRule" ADD CONSTRAINT "CrmAutomationRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmAutomationRule" ADD CONSTRAINT "CrmAutomationRule_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "CrmPipeline"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmAutomationRule" ADD CONSTRAINT "CrmAutomationRule_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "CrmStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmAutomationRun" ADD CONSTRAINT "CrmAutomationRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmAutomationRun" ADD CONSTRAINT "CrmAutomationRun_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "CrmAutomationRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmAutomationRun" ADD CONSTRAINT "CrmAutomationRun_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "CrmOpportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmNotification" ADD CONSTRAINT "CrmNotification_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
