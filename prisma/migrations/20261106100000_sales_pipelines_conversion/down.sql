-- Reverses migration.sql. Pipelines, stages, deals, stage history, assignment rules, the assignment settings and the merge and conversion links are lost; accounts, contacts, leads and consent records stay.
DROP TRIGGER "CrmStageHistory_immutable" ON "CrmStageHistory";
DROP FUNCTION crm_stage_history_immutable();
DROP TABLE "CrmAssignmentRule";
DROP TABLE "CrmStageHistory";
DROP TABLE "CrmOpportunity";
DROP TABLE "CrmStage";
DROP TABLE "CrmPipeline";
ALTER TABLE "CrmLead" DROP COLUMN "convertedOpportunityId";
ALTER TABLE "CrmContact" DROP CONSTRAINT "CrmContact_mergedIntoId_fkey";
ALTER TABLE "CrmContact" DROP COLUMN "mergedIntoId";
ALTER TABLE "CrmAccount" DROP CONSTRAINT "CrmAccount_mergedIntoId_fkey";
ALTER TABLE "CrmAccount" DROP COLUMN "mergedIntoId";
ALTER TABLE "CrmSetting" DROP COLUMN "assignmentCursor";
ALTER TABLE "CrmSetting" DROP COLUMN "assignmentMethod";
DROP TYPE "CrmAssignmentKind";
DROP TYPE "CrmAssignmentMethod";
DROP TYPE "CrmStageType";
DROP TYPE "CrmPipelineKind";
