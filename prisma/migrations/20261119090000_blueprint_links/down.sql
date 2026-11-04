-- Reverses migration.sql. Any link to a lead or proposal, and any saved configuration or quote, on a blueprint is lost (take a copy first if blueprints have been used for real).
ALTER TABLE "ClientBlueprint" DROP CONSTRAINT "ClientBlueprint_proposalId_fkey";
ALTER TABLE "ClientBlueprint" DROP CONSTRAINT "ClientBlueprint_leadId_fkey";
DROP INDEX "ClientBlueprint_proposalId_idx";
DROP INDEX "ClientBlueprint_leadId_idx";
ALTER TABLE "ClientBlueprint" DROP COLUMN "quote",
DROP COLUMN "proposalId",
DROP COLUMN "leadId",
DROP COLUMN "configured",
ADD COLUMN "opportunityId" TEXT;
CREATE INDEX "ClientBlueprint_opportunityId_idx" ON "ClientBlueprint"("opportunityId");
ALTER TABLE "ClientBlueprint" ADD CONSTRAINT "ClientBlueprint_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "CrmOpportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
