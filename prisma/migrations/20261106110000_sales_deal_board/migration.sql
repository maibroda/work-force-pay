-- Sales Phase 3a (docs/crm/03-phase-3-plan.md): what a deal needs to be worked on a board: what happens next, why it was lost and to whom, when it was won or lost,
-- and when it entered its current stage. Additive: one new type and new nullable (or defaulted) columns on CrmOpportunity.
-- To reverse, run down.sql in this folder (Prisma runs only migration.sql).

-- CreateEnum
CREATE TYPE "CrmLostReason" AS ENUM ('PRICE', 'QUALITY', 'RELATIONSHIP', 'INCUMBENT_RETAINED', 'NO_DECISION', 'BUDGET', 'OTHER');

-- AlterTable
ALTER TABLE "CrmOpportunity" ADD COLUMN     "competitor" TEXT,
ADD COLUMN     "lostAt" TIMESTAMP(3),
ADD COLUMN     "lostReason" "CrmLostReason",
ADD COLUMN     "lostReasonDetail" TEXT,
ADD COLUMN     "nextStep" TEXT,
ADD COLUMN     "stageEnteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "wonAt" TIMESTAMP(3);

-- A deal that already exists entered its current stage when its latest stage-history row was written.
UPDATE "CrmOpportunity" o SET "stageEnteredAt" = h."changedAt"
FROM (SELECT "opportunityId", MAX("changedAt") AS "changedAt" FROM "CrmStageHistory" GROUP BY "opportunityId") h
WHERE h."opportunityId" = o."id";
