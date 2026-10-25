-- CreateTable
CREATE TABLE "BankCode" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentFileExport" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "totalAmount" DECIMAL(16,2) NOT NULL,
    "excluded" JSONB NOT NULL,
    "checksum" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentFileExport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BankCode_organizationId_code_idx" ON "BankCode"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "BankCode_organizationId_name_key" ON "BankCode"("organizationId", "name");

-- CreateIndex
CREATE INDEX "PaymentFileExport_organizationId_runId_createdAt_idx" ON "PaymentFileExport"("organizationId", "runId", "createdAt");

-- AddForeignKey
ALTER TABLE "BankCode" ADD CONSTRAINT "BankCode_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentFileExport" ADD CONSTRAINT "PaymentFileExport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



ALTER TABLE "BankCode" ADD CONSTRAINT "BankCode_code_digits" CHECK ("code" ~ '^[0-9]{3,6}$');
ALTER TABLE "PaymentFileExport" ADD CONSTRAINT "PaymentFileExport_counts" CHECK ("rowCount" >= 0 AND "totalAmount" >= 0);

-- A record of a payment file produced is evidence of what was sent to the bank. It is never changed or removed.
CREATE OR REPLACE FUNCTION wfp_protect_payment_file_exports() RETURNS trigger AS $$
BEGIN
  IF current_setting('wfp.allow_ledger_reset', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'A payment file record cannot be changed or deleted.' USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wfp_payment_file_export_protected
  BEFORE UPDATE OR DELETE ON "PaymentFileExport"
  FOR EACH ROW EXECUTE FUNCTION wfp_protect_payment_file_exports();
