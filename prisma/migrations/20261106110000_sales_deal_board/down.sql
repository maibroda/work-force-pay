-- Reverses migration.sql. The next step, lost reason and detail, competitor, won and lost dates and the stage-entry date of every deal are lost; the deals, their stages and their stage history stay.
ALTER TABLE "CrmOpportunity" DROP COLUMN "wonAt";
ALTER TABLE "CrmOpportunity" DROP COLUMN "stageEnteredAt";
ALTER TABLE "CrmOpportunity" DROP COLUMN "nextStep";
ALTER TABLE "CrmOpportunity" DROP COLUMN "lostReasonDetail";
ALTER TABLE "CrmOpportunity" DROP COLUMN "lostReason";
ALTER TABLE "CrmOpportunity" DROP COLUMN "lostAt";
ALTER TABLE "CrmOpportunity" DROP COLUMN "competitor";
DROP TYPE "CrmLostReason";
