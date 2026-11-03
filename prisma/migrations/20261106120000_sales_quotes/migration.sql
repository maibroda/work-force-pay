-- Sales Phase 3b (docs/crm/03-phase-3-plan.md): priced quotes for a deal, with what the guards cost the company and the margin, plus the minimum margin setting.
-- Additive: one type, two tables and one column on CrmSetting. A trigger makes the lines of any quote that is not a draft permanent.
-- To reverse, run down.sql in this folder (Prisma runs only migration.sql).

-- CreateEnum
CREATE TYPE "CrmQuoteStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'SUPERSEDED');

-- AlterTable
ALTER TABLE "CrmSetting" ADD COLUMN     "minMarginBps" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "CrmQuote" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "status" "CrmQuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "validUntil" DATE,
    "notes" TEXT,
    "monthlyBill" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "monthlyCost" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "monthlyMargin" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "marginBps" INTEGER NOT NULL DEFAULT 0,
    "minMarginBpsAtQuote" INTEGER NOT NULL DEFAULT 0,
    "belowMinimum" BOOLEAN NOT NULL DEFAULT false,
    "belowMarginApproved" BOOLEAN NOT NULL DEFAULT false,
    "approvedBy" TEXT,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvalNote" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "sentBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decidedBy" TEXT,
    "decisionNote" TEXT,

    CONSTRAINT "CrmQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmQuoteLine" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "siteName" TEXT NOT NULL,
    "siteAddress" TEXT,
    "postLabel" TEXT,
    "shiftPattern" TEXT,
    "salaryStructureId" TEXT NOT NULL,
    "structureName" TEXT NOT NULL,
    "businessLine" TEXT NOT NULL,
    "headcount" INTEGER NOT NULL,
    "billPerHead" DECIMAL(16,2) NOT NULL,
    "operativeSharePct" DECIMAL(5,2) NOT NULL,
    "grossPerHead" DECIMAL(16,2) NOT NULL,
    "employerCostPerHead" DECIMAL(16,2) NOT NULL,
    "costPerHead" DECIMAL(16,2) NOT NULL,
    "lineBill" DECIMAL(16,2) NOT NULL,
    "lineCost" DECIMAL(16,2) NOT NULL,
    "lineMargin" DECIMAL(16,2) NOT NULL,
    "costBreakdown" JSONB NOT NULL,
    "ruleVersions" JSONB NOT NULL,
    "estimatedOn" DATE NOT NULL,

    CONSTRAINT "CrmQuoteLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CrmQuote_opportunityId_status_idx" ON "CrmQuote"("opportunityId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CrmQuote_organizationId_number_versionNo_key" ON "CrmQuote"("organizationId", "number", "versionNo");

-- CreateIndex
CREATE INDEX "CrmQuoteLine_quoteId_sortOrder_idx" ON "CrmQuoteLine"("quoteId", "sortOrder");

-- AddForeignKey
ALTER TABLE "CrmQuote" ADD CONSTRAINT "CrmQuote_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmQuote" ADD CONSTRAINT "CrmQuote_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "CrmOpportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmQuoteLine" ADD CONSTRAINT "CrmQuoteLine_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "CrmQuote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Once a quote has been sent (or decided, or superseded) its lines are permanent: a change is a new version.
CREATE OR REPLACE FUNCTION crm_quote_line_guard() RETURNS trigger AS $$
DECLARE
  qid TEXT;
  st TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN qid := OLD."quoteId"; ELSE qid := NEW."quoteId"; END IF;
  SELECT "status"::text INTO st FROM "CrmQuote" WHERE "id" = qid;
  IF st IS NOT NULL AND st <> 'DRAFT' THEN
    RAISE EXCEPTION 'The lines of a quote that has been sent cannot be changed or deleted. Make a new version instead.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CrmQuoteLine_guard" BEFORE INSERT OR UPDATE OR DELETE ON "CrmQuoteLine" FOR EACH ROW EXECUTE FUNCTION crm_quote_line_guard();
