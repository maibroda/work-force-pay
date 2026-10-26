-- CreateEnum
CREATE TYPE "LeadStage" AS ENUM ('QUALIFIED', 'DISCOVERY', 'PROPOSAL', 'PILOT', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "LeadSegment" AS ENUM ('SECURITY_FACILITIES', 'SME', 'OTHER');

-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('OUTBOUND', 'INBOUND', 'REFERRAL', 'EVENT', 'OTHER');

-- CreateEnum
CREATE TYPE "PartnerKind" AS ENUM ('ACCOUNTANT', 'HR_CONSULTANT', 'OTHER');

-- CreateEnum
CREATE TYPE "OutreachChannel" AS ENUM ('CALL', 'EMAIL', 'WHATSAPP', 'LINKEDIN', 'MEETING', 'OTHER');

-- CreateEnum
CREATE TYPE "OutreachOutcome" AS ENUM ('NO_ANSWER', 'CONNECTED', 'MEETING_BOOKED', 'QUALIFIED', 'NOT_INTERESTED');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'BUSINESS_DEV';

-- CreateTable
CREATE TABLE "ReferralPartner" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "PartnerKind" NOT NULL DEFAULT 'ACCOUNTANT',
    "contactName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "commissionPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "commissionMonths" INTEGER NOT NULL DEFAULT 12,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralPartner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "segment" "LeadSegment" NOT NULL DEFAULT 'SME',
    "headcount" INTEGER,
    "source" "LeadSource" NOT NULL DEFAULT 'OUTBOUND',
    "partnerId" TEXT,
    "contactName" TEXT NOT NULL,
    "contactRole" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "expectedMrr" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "stage" "LeadStage" NOT NULL DEFAULT 'QUALIFIED',
    "stageChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nextStep" TEXT,
    "nextStepOn" DATE,
    "ownerUserId" TEXT NOT NULL,
    "ownerName" TEXT NOT NULL,
    "lostReason" TEXT,
    "wonAt" TIMESTAMP(3),
    "lostAt" TIMESTAMP(3),
    "clientOrganizationId" TEXT,
    "notes" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadStageChange" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "fromStage" "LeadStage",
    "toStage" "LeadStage" NOT NULL,
    "note" TEXT,
    "byName" TEXT NOT NULL,
    "byUserId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadStageChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutreachActivity" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "leadId" TEXT,
    "company" TEXT NOT NULL,
    "contactName" TEXT,
    "channel" "OutreachChannel" NOT NULL,
    "outcome" "OutreachOutcome" NOT NULL,
    "note" TEXT,
    "date" DATE NOT NULL,
    "byName" TEXT NOT NULL,
    "byUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutreachActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralPayout" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "paidOn" DATE NOT NULL,
    "reference" TEXT,
    "byName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralPayout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReferralPartner_organizationId_name_key" ON "ReferralPartner"("organizationId", "name");

-- CreateIndex
CREATE INDEX "Lead_organizationId_stage_idx" ON "Lead"("organizationId", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_organizationId_number_key" ON "Lead"("organizationId", "number");

-- CreateIndex
CREATE INDEX "LeadStageChange_leadId_at_idx" ON "LeadStageChange"("leadId", "at");

-- CreateIndex
CREATE INDEX "LeadStageChange_organizationId_toStage_at_idx" ON "LeadStageChange"("organizationId", "toStage", "at");

-- CreateIndex
CREATE INDEX "OutreachActivity_organizationId_date_idx" ON "OutreachActivity"("organizationId", "date");

-- CreateIndex
CREATE INDEX "OutreachActivity_leadId_idx" ON "OutreachActivity"("leadId");

-- CreateIndex
CREATE INDEX "ReferralPayout_partnerId_idx" ON "ReferralPayout"("partnerId");

-- CreateIndex
CREATE INDEX "ReferralPayout_leadId_idx" ON "ReferralPayout"("leadId");

-- AddForeignKey
ALTER TABLE "ReferralPartner" ADD CONSTRAINT "ReferralPartner_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "ReferralPartner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadStageChange" ADD CONSTRAINT "LeadStageChange_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadStageChange" ADD CONSTRAINT "LeadStageChange_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachActivity" ADD CONSTRAINT "OutreachActivity_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachActivity" ADD CONSTRAINT "OutreachActivity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralPayout" ADD CONSTRAINT "ReferralPayout_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralPayout" ADD CONSTRAINT "ReferralPayout_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "ReferralPartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralPayout" ADD CONSTRAINT "ReferralPayout_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- The pipeline's rules, held by the database so no screen or script can get round them: a lost lead says why, a won lead has a fee and is
-- final (its fee and partner decide commission, so they can't be edited afterwards), the history of stage moves and outreach can't be
-- rewritten, and commission is paid only on a won lead and only to the partner who referred it.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_headcount_positive" CHECK ("headcount" IS NULL OR "headcount" > 0);
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_mrr_not_negative" CHECK ("expectedMrr" >= 0);
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_lost_says_why" CHECK ("stage" <> 'LOST' OR length(btrim(coalesce("lostReason", ''))) >= 5);
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_won_has_a_fee" CHECK ("stage" <> 'WON' OR "expectedMrr" > 0);
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_won_dated" CHECK (("stage" = 'WON') = ("wonAt" IS NOT NULL));
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_lost_dated" CHECK (("stage" = 'LOST') = ("lostAt" IS NOT NULL));
ALTER TABLE "ReferralPartner" ADD CONSTRAINT "ReferralPartner_pct_range" CHECK ("commissionPct" >= 0 AND "commissionPct" <= 100);
ALTER TABLE "ReferralPartner" ADD CONSTRAINT "ReferralPartner_months_range" CHECK ("commissionMonths" BETWEEN 1 AND 60);
-- a payout is a payment (positive) or a correction of one (negative, with a reference saying which)
ALTER TABLE "ReferralPayout" ADD CONSTRAINT "ReferralPayout_amount_not_zero" CHECK ("amount" <> 0);
ALTER TABLE "ReferralPayout" ADD CONSTRAINT "ReferralPayout_correction_says_why" CHECK ("amount" > 0 OR length(btrim(coalesce("reference", ''))) >= 5);

CREATE OR REPLACE FUNCTION wfp_lead_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A lead is never deleted; mark it lost instead.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."stage" = 'WON' AND (NEW."stage" <> 'WON' OR NEW."expectedMrr" IS DISTINCT FROM OLD."expectedMrr" OR NEW."partnerId" IS DISTINCT FROM OLD."partnerId" OR NEW."wonAt" IS DISTINCT FROM OLD."wonAt") THEN
    RAISE EXCEPTION 'A won lead is final: its stage, fee and referral partner cannot change.' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wfp_lead_guard BEFORE UPDATE OR DELETE ON "Lead"
  FOR EACH ROW EXECUTE FUNCTION wfp_lead_guard();

CREATE OR REPLACE FUNCTION wfp_crm_log_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'This record of what happened cannot be changed or removed.' USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wfp_lead_stage_change_guard BEFORE UPDATE OR DELETE ON "LeadStageChange" FOR EACH ROW EXECUTE FUNCTION wfp_crm_log_guard();
CREATE TRIGGER wfp_outreach_guard BEFORE UPDATE OR DELETE ON "OutreachActivity" FOR EACH ROW EXECUTE FUNCTION wfp_crm_log_guard();
CREATE TRIGGER wfp_referral_payout_guard BEFORE UPDATE OR DELETE ON "ReferralPayout" FOR EACH ROW EXECUTE FUNCTION wfp_crm_log_guard();

CREATE OR REPLACE FUNCTION wfp_referral_payout_check() RETURNS trigger AS $$
DECLARE l RECORD;
BEGIN
  SELECT "stage", "partnerId", "organizationId" INTO l FROM "Lead" WHERE "id" = NEW."leadId";
  IF l."stage" <> 'WON' THEN
    RAISE EXCEPTION 'Commission is paid only on a lead that has been won.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF l."partnerId" IS DISTINCT FROM NEW."partnerId" THEN
    RAISE EXCEPTION 'Commission is paid only to the partner who referred the lead.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF l."organizationId" <> NEW."organizationId" THEN
    RAISE EXCEPTION 'A payout belongs to the same organization as its lead.' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wfp_referral_payout_check BEFORE INSERT ON "ReferralPayout" FOR EACH ROW EXECUTE FUNCTION wfp_referral_payout_check();
