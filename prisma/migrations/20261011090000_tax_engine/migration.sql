-- CreateEnum
CREATE TYPE "TaxType" AS ENUM ('VAT', 'WHT');

-- CreateEnum
CREATE TYPE "TaxRateStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "TaxTransactionKind" AS ENUM ('OUTPUT_VAT', 'EXPECTED_WHT');

-- AlterTable
ALTER TABLE "ClientInvoice" ADD COLUMN     "taxBasis" JSONB;

-- CreateTable
CREATE TABLE "TaxCode" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "TaxType" NOT NULL,
    "accountCode" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxRate" (
    "id" TEXT NOT NULL,
    "taxCodeId" TEXT NOT NULL,
    "ratePct" DECIMAL(6,3) NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "status" "TaxRateStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedBy" TEXT,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,

    CONSTRAINT "TaxRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxTransaction" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "taxCodeId" TEXT,
    "kind" "TaxTransactionKind" NOT NULL,
    "sourceType" TEXT NOT NULL,
    "invoiceId" TEXT,
    "clientId" TEXT,
    "taxDate" DATE NOT NULL,
    "taxableAmount" DECIMAL(16,2) NOT NULL,
    "ratePct" DECIMAL(6,3) NOT NULL,
    "taxAmount" DECIMAL(16,2) NOT NULL,
    "reversed" BOOLEAN NOT NULL DEFAULT false,
    "reversedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaxCode_organizationId_type_idx" ON "TaxCode"("organizationId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "TaxCode_organizationId_code_key" ON "TaxCode"("organizationId", "code");

-- CreateIndex
CREATE INDEX "TaxRate_taxCodeId_status_effectiveFrom_idx" ON "TaxRate"("taxCodeId", "status", "effectiveFrom");

-- CreateIndex
CREATE INDEX "TaxTransaction_organizationId_kind_taxDate_idx" ON "TaxTransaction"("organizationId", "kind", "taxDate");

-- CreateIndex
CREATE INDEX "TaxTransaction_invoiceId_idx" ON "TaxTransaction"("invoiceId");

-- AddForeignKey
ALTER TABLE "TaxCode" ADD CONSTRAINT "TaxCode_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxRate" ADD CONSTRAINT "TaxRate_taxCodeId_fkey" FOREIGN KEY ("taxCodeId") REFERENCES "TaxCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxTransaction" ADD CONSTRAINT "TaxTransaction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxTransaction" ADD CONSTRAINT "TaxTransaction_taxCodeId_fkey" FOREIGN KEY ("taxCodeId") REFERENCES "TaxCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxTransaction" ADD CONSTRAINT "TaxTransaction_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "ClientInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Invoices issued before the tax engine: record the tax they already carry, from the figures stored on them, so the VAT
-- and withholding reports cover them too. Nothing on the invoices is touched.
INSERT INTO "TaxTransaction" ("id", "organizationId", "kind", "sourceType", "invoiceId", "clientId", "taxDate", "taxableAmount", "ratePct", "taxAmount", "reversed", "reversedAt")
SELECT 'txv' || md5(i."id"), i."organizationId", 'OUTPUT_VAT', 'CLIENT_INVOICE', i."id", i."clientId", i."invoiceDate", i."totalIndirectCharge", i."vatPct", i."vatAmount", (i."status" = 'CANCELLED'), CASE WHEN i."status" = 'CANCELLED' THEN now() END
FROM "ClientInvoice" i WHERE i."vatAmount" > 0;

INSERT INTO "TaxTransaction" ("id", "organizationId", "kind", "sourceType", "invoiceId", "clientId", "taxDate", "taxableAmount", "ratePct", "taxAmount", "reversed", "reversedAt")
SELECT 'txw' || md5(i."id"), i."organizationId", 'EXPECTED_WHT', 'CLIENT_INVOICE', i."id", i."clientId", i."invoiceDate", i."subtotal", i."whtPct", i."whtAmount", (i."status" = 'CANCELLED'), CASE WHEN i."status" = 'CANCELLED' THEN now() END
FROM "ClientInvoice" i WHERE i."whtAmount" > 0;

-- A rate that has been approved is history: it can't be edited or deleted, not even by SQL. The only change allowed to it is
-- the end date, set once, when a later rate takes over. A proposal can be decided (approved or rejected) but not reworded.
CREATE OR REPLACE FUNCTION wfp_protect_tax_rates() RETURNS trigger AS $$
BEGIN
  IF current_setting('wfp.allow_ledger_reset', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.status::text <> 'PENDING' THEN
      RAISE EXCEPTION 'A tax rate that has been decided cannot be deleted.' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW."ratePct" IS DISTINCT FROM OLD."ratePct" OR NEW."effectiveFrom" IS DISTINCT FROM OLD."effectiveFrom"
     OR NEW."taxCodeId" IS DISTINCT FROM OLD."taxCodeId" OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW."requestedByUserId" IS DISTINCT FROM OLD."requestedByUserId" THEN
    RAISE EXCEPTION 'A tax rate cannot be edited; propose a new rate from a later date instead.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status::text <> 'PENDING' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'A tax rate that has been decided cannot change status.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."effectiveTo" IS NOT NULL AND NEW."effectiveTo" IS DISTINCT FROM OLD."effectiveTo" THEN
    RAISE EXCEPTION 'The end date of a tax rate is set once.' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wfp_tax_rate_protected
  BEFORE UPDATE OR DELETE ON "TaxRate"
  FOR EACH ROW EXECUTE FUNCTION wfp_protect_tax_rates();

-- A tax transaction is a record of what was taxed on a posted document. It can be marked reversed (when the invoice is
-- cancelled) and nothing else.
CREATE OR REPLACE FUNCTION wfp_protect_tax_transactions() RETURNS trigger AS $$
BEGIN
  IF current_setting('wfp.allow_ledger_reset', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A tax transaction cannot be deleted.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."taxableAmount" IS DISTINCT FROM OLD."taxableAmount" OR NEW."taxAmount" IS DISTINCT FROM OLD."taxAmount"
     OR NEW."ratePct" IS DISTINCT FROM OLD."ratePct" OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW."invoiceId" IS DISTINCT FROM OLD."invoiceId" OR NEW."taxDate" IS DISTINCT FROM OLD."taxDate"
     OR NEW."taxCodeId" IS DISTINCT FROM OLD."taxCodeId" THEN
    RAISE EXCEPTION 'A tax transaction cannot be changed; it can only be marked reversed.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.reversed AND NOT NEW.reversed THEN
    RAISE EXCEPTION 'A reversed tax transaction cannot be reinstated.' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wfp_tax_transaction_protected
  BEFORE UPDATE OR DELETE ON "TaxTransaction"
  FOR EACH ROW EXECUTE FUNCTION wfp_protect_tax_transactions();
