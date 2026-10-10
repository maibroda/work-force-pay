-- CreateTable
CREATE TABLE "TaxCertificate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "certificateNumber" TEXT NOT NULL,
    "numberKey" TEXT NOT NULL,
    "issueDate" DATE NOT NULL,
    "receivedDate" DATE NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "document" TEXT,
    "notes" TEXT,
    "recordedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    "voidedBy" TEXT,
    "voidReason" TEXT,

    CONSTRAINT "TaxCertificate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaxCertificate_organizationId_clientId_numberKey_idx" ON "TaxCertificate"("organizationId", "clientId", "numberKey");

-- AddForeignKey
ALTER TABLE "TaxCertificate" ADD CONSTRAINT "TaxCertificate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxCertificate" ADD CONSTRAINT "TaxCertificate_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A certificate is evidence, so it is never edited or deleted. A wrong one is voided (once, with a reason) and entered again.
ALTER TABLE "TaxCertificate" ADD CONSTRAINT "TaxCertificate_amount" CHECK ("amount" > 0);

CREATE OR REPLACE FUNCTION wfp_protect_tax_certificates() RETURNS trigger AS $$
BEGIN
  IF current_setting('wfp.allow_ledger_reset', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A tax certificate cannot be deleted; void it with a reason instead.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."clientId" IS DISTINCT FROM OLD."clientId" OR NEW."certificateNumber" IS DISTINCT FROM OLD."certificateNumber"
     OR NEW."numberKey" IS DISTINCT FROM OLD."numberKey" OR NEW."issueDate" IS DISTINCT FROM OLD."issueDate"
     OR NEW."receivedDate" IS DISTINCT FROM OLD."receivedDate" OR NEW.amount IS DISTINCT FROM OLD.amount
     OR NEW.document IS DISTINCT FROM OLD.document OR NEW.notes IS DISTINCT FROM OLD.notes THEN
    RAISE EXCEPTION 'A tax certificate cannot be edited; void it and enter it again.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."voidedAt" IS NOT NULL AND (NEW."voidedAt" IS DISTINCT FROM OLD."voidedAt" OR NEW."voidReason" IS DISTINCT FROM OLD."voidReason") THEN
    RAISE EXCEPTION 'A tax certificate can only be voided once.' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wfp_tax_certificate_protected
  BEFORE UPDATE OR DELETE ON "TaxCertificate"
  FOR EACH ROW EXECUTE FUNCTION wfp_protect_tax_certificates();
