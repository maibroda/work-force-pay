-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- DropForeignKey
ALTER TABLE "ClientReceipt" DROP CONSTRAINT "ClientReceipt_invoiceId_fkey";

-- AlterTable
ALTER TABLE "ClientReceipt" ADD COLUMN     "notes" TEXT,
ADD COLUMN     "receiptNumber" TEXT,
ADD COLUMN     "whtReference" TEXT,
ADD COLUMN     "whtWithheld" DECIMAL(16,2) NOT NULL DEFAULT 0,
ALTER COLUMN "invoiceId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "ReceiptAllocation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "cashAmount" DECIMAL(16,2) NOT NULL,
    "whtAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "appliedOn" DATE NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversedAt" TIMESTAMP(3),
    "reversedOn" DATE,
    "reversedBy" TEXT,
    "reversalReason" TEXT,

    CONSTRAINT "ReceiptAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientRefund" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "refundNumber" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "refundDate" DATE NOT NULL,
    "method" TEXT,
    "reference" TEXT,
    "reason" TEXT NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "requestedBy" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedBy" TEXT,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,

    CONSTRAINT "ClientRefund_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReceiptAllocation_organizationId_invoiceId_idx" ON "ReceiptAllocation"("organizationId", "invoiceId");

-- CreateIndex
CREATE INDEX "ReceiptAllocation_receiptId_idx" ON "ReceiptAllocation"("receiptId");

-- CreateIndex
CREATE INDEX "ClientRefund_receiptId_idx" ON "ClientRefund"("receiptId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientRefund_organizationId_refundNumber_key" ON "ClientRefund"("organizationId", "refundNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ClientReceipt_organizationId_receiptNumber_key" ON "ClientReceipt"("organizationId", "receiptNumber");

-- AddForeignKey
ALTER TABLE "ClientReceipt" ADD CONSTRAINT "ClientReceipt_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "ClientInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptAllocation" ADD CONSTRAINT "ReceiptAllocation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptAllocation" ADD CONSTRAINT "ReceiptAllocation_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "ClientReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptAllocation" ADD CONSTRAINT "ReceiptAllocation_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "ClientInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientRefund" ADD CONSTRAINT "ClientRefund_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientRefund" ADD CONSTRAINT "ClientRefund_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "ClientReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientRefund" ADD CONSTRAINT "ClientRefund_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- An allocation applies a positive amount; the split is cash plus tax withheld.
ALTER TABLE "ReceiptAllocation" ADD CONSTRAINT "ReceiptAllocation_amounts" CHECK ("cashAmount" >= 0 AND "whtAmount" >= 0 AND "cashAmount" + "whtAmount" > 0);
ALTER TABLE "ClientRefund" ADD CONSTRAINT "ClientRefund_positive" CHECK ("amount" > 0);

-- An allocation is never edited or deleted. If it was applied to the wrong invoice it is reversed (once, with a reason) and the
-- amount returns to the receipt to be applied again.
CREATE OR REPLACE FUNCTION wfp_protect_receipt_allocations() RETURNS trigger AS $$
BEGIN
  IF current_setting('wfp.allow_ledger_reset', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A receipt allocation cannot be deleted; reverse it with a reason instead.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."cashAmount" IS DISTINCT FROM OLD."cashAmount" OR NEW."whtAmount" IS DISTINCT FROM OLD."whtAmount"
     OR NEW."receiptId" IS DISTINCT FROM OLD."receiptId" OR NEW."invoiceId" IS DISTINCT FROM OLD."invoiceId"
     OR NEW."appliedOn" IS DISTINCT FROM OLD."appliedOn" THEN
    RAISE EXCEPTION 'A receipt allocation cannot be edited; reverse it and apply the amount again.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."reversedAt" IS NOT NULL AND (NEW."reversedAt" IS DISTINCT FROM OLD."reversedAt" OR NEW."reversalReason" IS DISTINCT FROM OLD."reversalReason") THEN
    RAISE EXCEPTION 'A receipt allocation can only be reversed once.' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wfp_receipt_allocation_protected
  BEFORE UPDATE OR DELETE ON "ReceiptAllocation"
  FOR EACH ROW EXECUTE FUNCTION wfp_protect_receipt_allocations();
