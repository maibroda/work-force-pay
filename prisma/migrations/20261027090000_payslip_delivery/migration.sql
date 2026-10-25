-- CreateTable
CREATE TABLE "PayslipSetting" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayslipSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayslipDelivery" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "toEmail" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "sentBy" TEXT NOT NULL,
    "sentByUserId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayslipDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PayslipSetting_organizationId_key" ON "PayslipSetting"("organizationId");

-- CreateIndex
CREATE INDEX "PayslipDelivery_organizationId_runId_idx" ON "PayslipDelivery"("organizationId", "runId");

-- CreateIndex
CREATE INDEX "PayslipDelivery_recordId_idx" ON "PayslipDelivery"("recordId");

-- AddForeignKey
ALTER TABLE "PayslipSetting" ADD CONSTRAINT "PayslipSetting_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayslipDelivery" ADD CONSTRAINT "PayslipDelivery_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- A record of a payslip emailed is evidence of what was sent and to whom. It is never changed or removed.
CREATE OR REPLACE FUNCTION wfp_protect_payslip_deliveries() RETURNS trigger AS $$
BEGIN
  IF current_setting('wfp.allow_ledger_reset', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'A payslip delivery record cannot be changed or deleted.' USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wfp_payslip_delivery_protected
  BEFORE UPDATE OR DELETE ON "PayslipDelivery"
  FOR EACH ROW EXECUTE FUNCTION wfp_protect_payslip_deliveries();
