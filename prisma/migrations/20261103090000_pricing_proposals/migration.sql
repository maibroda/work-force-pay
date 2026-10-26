-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('DRAFT', 'APPROVED', 'SENT', 'ACCEPTED', 'DECLINED', 'SUPERSEDED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "PricingSetting" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "hourlyCost" DECIMAL(12,2) NOT NULL,
    "softwareFixed" DECIMAL(12,2) NOT NULL,
    "softwarePerEmployee" DECIMAL(12,2) NOT NULL,
    "overheadPct" DECIMAL(5,2) NOT NULL,
    "targetMarginPct" DECIMAL(5,2) NOT NULL,
    "vatRatePct" DECIMAL(5,2) NOT NULL DEFAULT 7.5,
    "validityDays" INTEGER NOT NULL DEFAULT 30,
    "confirmedBy" TEXT,
    "confirmedByUserId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "updatedBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PricingSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingPackage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "perEmployeeRate" DECIMAL(12,2) NOT NULL,
    "monthlyMinimum" DECIMAL(12,2) NOT NULL,
    "onboardingFee" DECIMAL(12,2) NOT NULL,
    "baseHours" DECIMAL(8,2) NOT NULL,
    "minutesPerEmployee" DECIMAL(8,2) NOT NULL,
    "scope" TEXT NOT NULL,
    "responsibilities" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PricingPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingAddOn" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "monthlyFee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "perEmployeeFee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "onboardingFee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "hours" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "minutesPerEmployee" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PricingAddOn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Proposal" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "packageKey" TEXT NOT NULL,
    "headcount" INTEGER NOT NULL,
    "termMonths" INTEGER NOT NULL,
    "extraHours" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "discountPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "discountReason" TEXT,
    "addOnCodes" TEXT[],
    "quote" JSONB NOT NULL,
    "monthlyFee" DECIMAL(14,2) NOT NULL,
    "onboardingFee" DECIMAL(14,2) NOT NULL,
    "marginPct" DECIMAL(7,2) NOT NULL,
    "belowTarget" BOOLEAN NOT NULL DEFAULT false,
    "status" "ProposalStatus" NOT NULL DEFAULT 'DRAFT',
    "approvedBy" TEXT,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvalNote" TEXT,
    "validUntil" DATE,
    "sentAt" TIMESTAMP(3),
    "sentBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Proposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PricingSetting_organizationId_key" ON "PricingSetting"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PricingPackage_organizationId_key_key" ON "PricingPackage"("organizationId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "PricingAddOn_organizationId_code_key" ON "PricingAddOn"("organizationId", "code");

-- CreateIndex
CREATE INDEX "Proposal_leadId_idx" ON "Proposal"("leadId");

-- CreateIndex
CREATE INDEX "Proposal_organizationId_status_idx" ON "Proposal"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Proposal_organizationId_number_key" ON "Proposal"("organizationId", "number");

-- AddForeignKey
ALTER TABLE "PricingSetting" ADD CONSTRAINT "PricingSetting_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingPackage" ADD CONSTRAINT "PricingPackage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingAddOn" ADD CONSTRAINT "PricingAddOn_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- Pricing rules held by the database: sensible ranges on the rate card, a proposal below the target margin can't go out without a recorded
-- approval and a reason, and once a proposal has been sent what it says can't change (a revised offer is a new proposal).
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE "PricingSetting" ADD CONSTRAINT "PricingSetting_ranges" CHECK ("hourlyCost" >= 0 AND "softwareFixed" >= 0 AND "softwarePerEmployee" >= 0 AND "overheadPct" BETWEEN 0 AND 300 AND "targetMarginPct" >= 0 AND "targetMarginPct" < 100 AND "vatRatePct" BETWEEN 0 AND 50 AND "validityDays" BETWEEN 1 AND 180);
ALTER TABLE "PricingSetting" ADD CONSTRAINT "PricingSetting_confirmed_together" CHECK (("confirmedAt" IS NULL) = ("confirmedBy" IS NULL));
ALTER TABLE "PricingPackage" ADD CONSTRAINT "PricingPackage_ranges" CHECK ("perEmployeeRate" >= 0 AND "monthlyMinimum" >= 0 AND "onboardingFee" >= 0 AND "baseHours" >= 0 AND "minutesPerEmployee" >= 0);
ALTER TABLE "PricingAddOn" ADD CONSTRAINT "PricingAddOn_ranges" CHECK ("monthlyFee" >= 0 AND "perEmployeeFee" >= 0 AND "onboardingFee" >= 0 AND "hours" >= 0 AND "minutesPerEmployee" >= 0);

ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_headcount_positive" CHECK ("headcount" > 0);
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_term" CHECK ("termMonths" IN (6, 12));
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_discount_range" CHECK ("discountPct" >= 0 AND "discountPct" <= 100 AND "extraHours" >= 0 AND "monthlyFee" >= 0 AND "onboardingFee" >= 0);
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_discount_says_why" CHECK ("discountPct" = 0 OR length(btrim(coalesce("discountReason", ''))) >= 5);
-- a proposal below the target margin goes out only with a recorded approval and a reason
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_below_margin_approved" CHECK (NOT "belowTarget" OR "status" IN ('DRAFT', 'SUPERSEDED', 'WITHDRAWN') OR ("approvedAt" IS NOT NULL AND "approvedBy" IS NOT NULL AND length(btrim(coalesce("approvalNote", ''))) >= 10));
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_sent_dated" CHECK ("status" NOT IN ('SENT', 'ACCEPTED', 'DECLINED') OR ("sentAt" IS NOT NULL AND "validUntil" IS NOT NULL));
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_decided_dated" CHECK ("status" NOT IN ('ACCEPTED', 'DECLINED') OR "decidedAt" IS NOT NULL);

CREATE OR REPLACE FUNCTION wfp_proposal_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A proposal is never deleted; withdraw it instead.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."status" IN ('ACCEPTED', 'DECLINED', 'SUPERSEDED', 'WITHDRAWN') THEN
    RAISE EXCEPTION 'This proposal has been decided and cannot change.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."status" = 'SENT' THEN
    IF NEW."status" NOT IN ('SENT', 'ACCEPTED', 'DECLINED', 'SUPERSEDED') THEN
      RAISE EXCEPTION 'A sent proposal can only be accepted, declined or superseded.' USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW."leadId" IS DISTINCT FROM OLD."leadId" OR NEW."number" IS DISTINCT FROM OLD."number" OR NEW."packageKey" IS DISTINCT FROM OLD."packageKey"
       OR NEW."headcount" IS DISTINCT FROM OLD."headcount" OR NEW."termMonths" IS DISTINCT FROM OLD."termMonths" OR NEW."extraHours" IS DISTINCT FROM OLD."extraHours"
       OR NEW."discountPct" IS DISTINCT FROM OLD."discountPct" OR NEW."discountReason" IS DISTINCT FROM OLD."discountReason" OR NEW."addOnCodes" IS DISTINCT FROM OLD."addOnCodes"
       OR NEW."quote"::text IS DISTINCT FROM OLD."quote"::text OR NEW."monthlyFee" IS DISTINCT FROM OLD."monthlyFee" OR NEW."onboardingFee" IS DISTINCT FROM OLD."onboardingFee"
       OR NEW."marginPct" IS DISTINCT FROM OLD."marginPct" OR NEW."belowTarget" IS DISTINCT FROM OLD."belowTarget" OR NEW."validUntil" IS DISTINCT FROM OLD."validUntil"
       OR NEW."sentAt" IS DISTINCT FROM OLD."sentAt" OR NEW."approvedAt" IS DISTINCT FROM OLD."approvedAt" OR NEW."approvalNote" IS DISTINCT FROM OLD."approvalNote" THEN
      RAISE EXCEPTION 'What a sent proposal says cannot change; make a new proposal instead.' USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wfp_proposal_guard BEFORE UPDATE OR DELETE ON "Proposal" FOR EACH ROW EXECUTE FUNCTION wfp_proposal_guard();
