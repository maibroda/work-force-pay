-- Sales Phase 2a (docs/crm/02-phase-2-plan.md): pipelines, stages, deals and their stage history, owner-assignment rules, and the links that merging and converting need.
-- Additive only: new tables and types, and new nullable or defaulted columns on the Phase 1a tables. Stage history is made permanent by a trigger.
-- To reverse, run down.sql in this folder (Prisma runs only migration.sql).

-- CreateEnum
CREATE TYPE "CrmPipelineKind" AS ENUM ('NEW_BUSINESS', 'RENEWAL', 'RATE_REVIEW', 'EXPANSION');

-- CreateEnum
CREATE TYPE "CrmStageType" AS ENUM ('OPEN', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "CrmAssignmentMethod" AS ENUM ('NONE', 'ROUND_ROBIN', 'BY_STATE', 'BY_SERVICE');

-- CreateEnum
CREATE TYPE "CrmAssignmentKind" AS ENUM ('STATE', 'SERVICE');

-- AlterTable
ALTER TABLE "CrmSetting" ADD COLUMN     "assignmentCursor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "assignmentMethod" "CrmAssignmentMethod" NOT NULL DEFAULT 'NONE';

-- AlterTable
ALTER TABLE "CrmAccount" ADD COLUMN     "mergedIntoId" TEXT;

-- AlterTable
ALTER TABLE "CrmContact" ADD COLUMN     "mergedIntoId" TEXT;

-- AlterTable
ALTER TABLE "CrmLead" ADD COLUMN     "convertedOpportunityId" TEXT;

-- CreateTable
CREATE TABLE "CrmPipeline" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "CrmPipelineKind" NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmPipeline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmStage" (
    "id" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "stageType" "CrmStageType" NOT NULL DEFAULT 'OPEN',
    "defaultProbability" INTEGER NOT NULL,
    "requiredFields" JSONB NOT NULL DEFAULT '[]',
    "rottingDays" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CrmStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmOpportunity" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "primaryContactId" TEXT,
    "pipelineId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "serviceType" "CrmServiceInterest" NOT NULL DEFAULT 'OTHER',
    "monthlyContractValue" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "probability" INTEGER NOT NULL,
    "expectedCloseDate" DATE,
    "expectedStartDate" DATE,
    "contractTermMonths" INTEGER,
    "source" "CrmSource",
    "sourceDetail" TEXT,
    "ownerUserId" TEXT NOT NULL,
    "ownerName" TEXT NOT NULL,
    "fromLeadId" TEXT,
    "status" "CrmRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    "voidedBy" TEXT,
    "voidReason" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmOpportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmStageHistory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "fromStageId" TEXT,
    "toStageId" TEXT NOT NULL,
    "changedBy" TEXT NOT NULL,
    "changedByUserId" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "daysInPreviousStage" INTEGER,

    CONSTRAINT "CrmStageHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmAssignmentRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" "CrmAssignmentKind" NOT NULL,
    "key" TEXT NOT NULL,
    "keyNorm" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmAssignmentRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CrmPipeline_organizationId_name_key" ON "CrmPipeline"("organizationId", "name");

-- CreateIndex
CREATE INDEX "CrmStage_pipelineId_sortOrder_idx" ON "CrmStage"("pipelineId", "sortOrder");

-- CreateIndex
CREATE INDEX "CrmOpportunity_organizationId_ownerUserId_status_idx" ON "CrmOpportunity"("organizationId", "ownerUserId", "status");

-- CreateIndex
CREATE INDEX "CrmOpportunity_organizationId_stageId_idx" ON "CrmOpportunity"("organizationId", "stageId");

-- CreateIndex
CREATE INDEX "CrmOpportunity_accountId_idx" ON "CrmOpportunity"("accountId");

-- CreateIndex
CREATE INDEX "CrmStageHistory_opportunityId_changedAt_idx" ON "CrmStageHistory"("opportunityId", "changedAt");

-- CreateIndex
CREATE INDEX "CrmStageHistory_organizationId_toStageId_changedAt_idx" ON "CrmStageHistory"("organizationId", "toStageId", "changedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CrmAssignmentRule_organizationId_kind_keyNorm_key" ON "CrmAssignmentRule"("organizationId", "kind", "keyNorm");

-- AddForeignKey
ALTER TABLE "CrmAccount" ADD CONSTRAINT "CrmAccount_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "CrmAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmContact" ADD CONSTRAINT "CrmContact_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "CrmContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmPipeline" ADD CONSTRAINT "CrmPipeline_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmStage" ADD CONSTRAINT "CrmStage_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "CrmPipeline"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmOpportunity" ADD CONSTRAINT "CrmOpportunity_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmOpportunity" ADD CONSTRAINT "CrmOpportunity_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "CrmAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmOpportunity" ADD CONSTRAINT "CrmOpportunity_primaryContactId_fkey" FOREIGN KEY ("primaryContactId") REFERENCES "CrmContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmOpportunity" ADD CONSTRAINT "CrmOpportunity_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "CrmPipeline"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmOpportunity" ADD CONSTRAINT "CrmOpportunity_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "CrmStage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmStageHistory" ADD CONSTRAINT "CrmStageHistory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmStageHistory" ADD CONSTRAINT "CrmStageHistory_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "CrmOpportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmAssignmentRule" ADD CONSTRAINT "CrmAssignmentRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Stage history is permanent: a move between stages is only ever added, never changed or removed.
CREATE OR REPLACE FUNCTION crm_stage_history_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'A stage history record cannot be changed or deleted.' USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CrmStageHistory_immutable" BEFORE UPDATE OR DELETE ON "CrmStageHistory" FOR EACH ROW EXECUTE FUNCTION crm_stage_history_immutable();
