-- E4c (docs/plans/module-entitlements-e4.md): a blueprint links to the bureau's own lead and proposal (the founder, 2026-11-03), not to a company-sales deal, and keeps what the
-- configurator computed and the quote it was given. The blueprint table has never had a screen or any code that wrote to it, so the old link is empty. This refuses to run, and
-- changes nothing, if any blueprint does hold that link: then someone must decide what to do with it first.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "ClientBlueprint" WHERE "opportunityId" IS NOT NULL) THEN
    RAISE EXCEPTION 'A blueprint is linked to a company-sales deal; move or clear that link before this migration (docs/plans/module-entitlements-e4.md).';
  END IF;
END $$;

-- DropForeignKey
ALTER TABLE "ClientBlueprint" DROP CONSTRAINT "ClientBlueprint_opportunityId_fkey";
-- DropIndex
DROP INDEX "ClientBlueprint_opportunityId_idx";
-- AlterTable
ALTER TABLE "ClientBlueprint" DROP COLUMN "opportunityId",
ADD COLUMN     "configured" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "leadId" TEXT,
ADD COLUMN     "proposalId" TEXT,
ADD COLUMN     "quote" JSONB;
-- CreateIndex
CREATE INDEX "ClientBlueprint_leadId_idx" ON "ClientBlueprint"("leadId");
-- CreateIndex
CREATE INDEX "ClientBlueprint_proposalId_idx" ON "ClientBlueprint"("proposalId");
-- AddForeignKey
ALTER TABLE "ClientBlueprint" ADD CONSTRAINT "ClientBlueprint_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ClientBlueprint" ADD CONSTRAINT "ClientBlueprint_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
