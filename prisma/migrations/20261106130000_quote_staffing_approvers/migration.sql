-- Sales Phase 3b, second part (docs/crm/03-phase-3-plan.md, founder's answers of 2026-10-29):
--   1. a quote line separates the guards the client is BILLED for (headcount) from the personnel actually needed to cover the agreed shifts (requiredPersonnel);
--   2. a new organization starts with a 15% minimum gross margin (it was none);
--   3. a quote below the minimum can be approved only by a formally designated approver.
-- Additive. Existing lines take the billed headcount as the personnel needed (what they were priced on). The guard trigger on the lines is switched off only for
-- that one fill, then back on. Existing organizations keep the minimum they already have. To reverse, run down.sql in this folder.

ALTER TABLE "CrmSetting" ALTER COLUMN "minMarginBps" SET DEFAULT 1500;

ALTER TABLE "CrmQuoteLine" ADD COLUMN "requiredPersonnel" INTEGER;
ALTER TABLE "CrmQuoteLine" DISABLE TRIGGER "CrmQuoteLine_guard";
UPDATE "CrmQuoteLine" SET "requiredPersonnel" = "headcount";
ALTER TABLE "CrmQuoteLine" ENABLE TRIGGER "CrmQuoteLine_guard";
ALTER TABLE "CrmQuoteLine" ALTER COLUMN "requiredPersonnel" SET NOT NULL;

-- CreateTable
CREATE TABLE "CrmQuoteApprover" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "designatedBy" TEXT NOT NULL,
    "designatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedBy" TEXT,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "CrmQuoteApprover_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CrmQuoteApprover_organizationId_userId_key" ON "CrmQuoteApprover"("organizationId", "userId");

-- AddForeignKey
ALTER TABLE "CrmQuoteApprover" ADD CONSTRAINT "CrmQuoteApprover_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
