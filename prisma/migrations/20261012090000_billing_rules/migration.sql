-- CreateEnum
CREATE TYPE "BillingBase" AS ENUM ('INDIRECT', 'DIRECT', 'FULL', 'NONE');

-- CreateEnum
CREATE TYPE "BillingRuleStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "ClientInvoiceLine" ADD COLUMN     "billingRuleId" TEXT;

-- AlterTable
ALTER TABLE "Contract" ADD COLUMN     "serviceTypeId" TEXT;

-- CreateTable
CREATE TABLE "ServiceType" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "serviceTypeId" TEXT,
    "contractId" TEXT,
    "directPct" DECIMAL(5,2) NOT NULL,
    "indirectPct" DECIMAL(5,2) NOT NULL,
    "vatBase" "BillingBase" NOT NULL DEFAULT 'INDIRECT',
    "whtBase" "BillingBase" NOT NULL DEFAULT 'FULL',
    "vatTaxCodeId" TEXT,
    "whtTaxCodeId" TEXT,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "status" "BillingRuleStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedBy" TEXT,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,

    CONSTRAINT "BillingRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ServiceType_organizationId_code_key" ON "ServiceType"("organizationId", "code");

-- CreateIndex
CREATE INDEX "BillingRule_organizationId_serviceTypeId_status_idx" ON "BillingRule"("organizationId", "serviceTypeId", "status");

-- CreateIndex
CREATE INDEX "BillingRule_organizationId_contractId_status_idx" ON "BillingRule"("organizationId", "contractId", "status");

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_serviceTypeId_fkey" FOREIGN KEY ("serviceTypeId") REFERENCES "ServiceType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientInvoiceLine" ADD CONSTRAINT "ClientInvoiceLine_billingRuleId_fkey" FOREIGN KEY ("billingRuleId") REFERENCES "BillingRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceType" ADD CONSTRAINT "ServiceType_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingRule" ADD CONSTRAINT "BillingRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingRule" ADD CONSTRAINT "BillingRule_serviceTypeId_fkey" FOREIGN KEY ("serviceTypeId") REFERENCES "ServiceType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingRule" ADD CONSTRAINT "BillingRule_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A rule is for a service type or for one contract, never both or neither, and always splits 100%.
ALTER TABLE "BillingRule" ADD CONSTRAINT "BillingRule_one_scope" CHECK (("serviceTypeId" IS NULL) <> ("contractId" IS NULL));
ALTER TABLE "BillingRule" ADD CONSTRAINT "BillingRule_split_100" CHECK ("directPct" + "indirectPct" = 100 AND "directPct" >= 0 AND "indirectPct" >= 0);

-- Every existing organization is billed as Security & Guarding today: 90% direct / 10% indirect, VAT on the indirect charge,
-- withholding on the whole amount. Record exactly that as an approved rule from the start of time, and put every contract
-- under it, so what the system does is written down and nothing changes.
INSERT INTO "ServiceType" ("id", "organizationId", "code", "name", "active", "createdBy")
SELECT 'svc' || md5(o."id"), o."id", 'SECURITY', 'Security & Guarding', true, 'System (migration)' FROM "Organization" o;

UPDATE "Contract" SET "serviceTypeId" = 'svc' || md5("organizationId");

INSERT INTO "BillingRule" ("id", "organizationId", "serviceTypeId", "directPct", "indirectPct", "vatBase", "whtBase", "effectiveFrom", "status", "reason", "requestedBy", "requestedByUserId", "decidedBy", "decidedByUserId", "decidedAt", "decisionNote")
SELECT 'bru' || md5(o."id"), o."id", 'svc' || md5(o."id"), 90, 10, 'INDIRECT', 'FULL', DATE '2000-01-01', 'APPROVED',
       'The treatment in force before billing rules existed: 90% direct and 10% indirect charge, VAT on the indirect charge, withholding tax on the whole amount.',
       'System (migration)', 'system', 'System (migration)', 'system', now(), 'Recorded as it was, so that nothing changes.'
FROM "Organization" o;

-- An approved billing rule is history: it can't be edited or deleted, not even by SQL. Only its end date can be set, once,
-- when a later rule takes over. A proposal can be decided but not reworded.
CREATE OR REPLACE FUNCTION wfp_protect_billing_rules() RETURNS trigger AS $$
BEGIN
  IF current_setting('wfp.allow_ledger_reset', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.status::text <> 'PENDING' THEN
      RAISE EXCEPTION 'A billing rule that has been decided cannot be deleted.' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW."directPct" IS DISTINCT FROM OLD."directPct" OR NEW."indirectPct" IS DISTINCT FROM OLD."indirectPct"
     OR NEW."vatBase" IS DISTINCT FROM OLD."vatBase" OR NEW."whtBase" IS DISTINCT FROM OLD."whtBase"
     OR NEW."vatTaxCodeId" IS DISTINCT FROM OLD."vatTaxCodeId" OR NEW."whtTaxCodeId" IS DISTINCT FROM OLD."whtTaxCodeId"
     OR NEW."effectiveFrom" IS DISTINCT FROM OLD."effectiveFrom" OR NEW."serviceTypeId" IS DISTINCT FROM OLD."serviceTypeId"
     OR NEW."contractId" IS DISTINCT FROM OLD."contractId" OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW."requestedByUserId" IS DISTINCT FROM OLD."requestedByUserId" THEN
    RAISE EXCEPTION 'A billing rule cannot be edited; propose a new rule from a later date instead.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status::text <> 'PENDING' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'A billing rule that has been decided cannot change status.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."effectiveTo" IS NOT NULL AND NEW."effectiveTo" IS DISTINCT FROM OLD."effectiveTo" THEN
    RAISE EXCEPTION 'The end date of a billing rule is set once.' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wfp_billing_rule_protected
  BEFORE UPDATE OR DELETE ON "BillingRule"
  FOR EACH ROW EXECUTE FUNCTION wfp_protect_billing_rules();
