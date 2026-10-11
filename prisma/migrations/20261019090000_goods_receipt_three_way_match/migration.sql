-- CreateEnum
CREATE TYPE "BillMatchStatus" AS ENUM ('NOT_REQUIRED', 'MATCHED', 'EXCEPTION', 'APPROVED');

-- CreateEnum
CREATE TYPE "GoodsReceiptStatus" AS ENUM ('POSTED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "billApprovalThreshold" DECIMAL(16,2) NOT NULL DEFAULT 500000,
ADD COLUMN     "matchPricePct" DECIMAL(5,2) NOT NULL DEFAULT 1,
ADD COLUMN     "matchQtyPct" DECIMAL(5,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PurchaseInvoice" ADD COLUMN     "createdByUserId" TEXT,
ADD COLUMN     "matchApprovalReason" TEXT,
ADD COLUMN     "matchApprovedAt" TIMESTAMP(3),
ADD COLUMN     "matchApprovedBy" TEXT,
ADD COLUMN     "matchApprovedByUserId" TEXT,
ADD COLUMN     "matchExceptions" JSONB,
ADD COLUMN     "matchStatus" "BillMatchStatus" NOT NULL DEFAULT 'NOT_REQUIRED';

-- AlterTable
ALTER TABLE "PurchaseInvoiceLine" ADD COLUMN     "orderLineId" TEXT;

-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "decidedByUserId" TEXT,
ADD COLUMN     "requestedByUserId" TEXT;

-- CreateTable
CREATE TABLE "GoodsReceipt" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "receivedDate" DATE NOT NULL,
    "deliveryNote" TEXT,
    "notes" TEXT,
    "status" "GoodsReceiptStatus" NOT NULL DEFAULT 'POSTED',
    "receivedBy" TEXT NOT NULL,
    "receivedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" TEXT,
    "cancelReason" TEXT,

    CONSTRAINT "GoodsReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceiptLine" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "GoodsReceiptLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GoodsReceipt_organizationId_orderId_idx" ON "GoodsReceipt"("organizationId", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceipt_organizationId_receiptNumber_key" ON "GoodsReceipt"("organizationId", "receiptNumber");

-- CreateIndex
CREATE INDEX "GoodsReceiptLine_orderLineId_idx" ON "GoodsReceiptLine"("orderLineId");

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "GoodsReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "PurchaseOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseInvoiceLine" ADD CONSTRAINT "PurchaseInvoiceLine_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "PurchaseOrderLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;



ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_match_policy_nonneg" CHECK ("matchPricePct" >= 0 AND "matchQtyPct" >= 0 AND "billApprovalThreshold" >= 0);

-- A goods receipt is a record of fact: its lines never change, and the receipt itself is only ever cancelled, once, with who and why.
CREATE OR REPLACE FUNCTION wfp_protect_goods_receipt_lines() RETURNS trigger AS $$
BEGIN
  IF current_setting('wfp.allow_ledger_reset', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'A goods receipt line cannot be changed or deleted. Cancel the receipt instead.' USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wfp_goods_receipt_line_protected
  BEFORE UPDATE OR DELETE ON "GoodsReceiptLine"
  FOR EACH ROW EXECUTE FUNCTION wfp_protect_goods_receipt_lines();

CREATE OR REPLACE FUNCTION wfp_protect_goods_receipts() RETURNS trigger AS $$
BEGIN
  IF current_setting('wfp.allow_ledger_reset', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A goods receipt cannot be deleted. Cancel it instead.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId" OR NEW."receiptNumber" IS DISTINCT FROM OLD."receiptNumber"
     OR NEW."orderId" IS DISTINCT FROM OLD."orderId" OR NEW."vendorId" IS DISTINCT FROM OLD."vendorId"
     OR NEW."receivedDate" IS DISTINCT FROM OLD."receivedDate" OR NEW."deliveryNote" IS DISTINCT FROM OLD."deliveryNote"
     OR NEW.notes IS DISTINCT FROM OLD.notes OR NEW."receivedBy" IS DISTINCT FROM OLD."receivedBy"
     OR NEW."receivedByUserId" IS DISTINCT FROM OLD."receivedByUserId" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'A goods receipt cannot be changed. Cancel it and record a new one.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status = 'CANCELLED' THEN
    RAISE EXCEPTION 'This goods receipt is already cancelled.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status = 'CANCELLED' AND (NEW."cancelledAt" IS NULL OR NEW."cancelledBy" IS NULL OR NEW."cancelReason" IS NULL) THEN
    RAISE EXCEPTION 'A cancelled goods receipt needs who cancelled it, when and why.' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wfp_goods_receipt_protected
  BEFORE UPDATE OR DELETE ON "GoodsReceipt"
  FOR EACH ROW EXECUTE FUNCTION wfp_protect_goods_receipts();

-- No payment can be recorded against a bill whose three-way match has unresolved exceptions.
CREATE OR REPLACE FUNCTION wfp_guard_vendor_payment_match() RETURNS trigger AS $$
DECLARE st "BillMatchStatus";
BEGIN
  IF current_setting('wfp.allow_ledger_reset', true) = 'on' THEN RETURN NEW; END IF;
  SELECT "matchStatus" INTO st FROM "PurchaseInvoice" WHERE id = NEW."invoiceId";
  IF st = 'EXCEPTION' THEN
    RAISE EXCEPTION 'This bill has unresolved match exceptions; a second person has to approve it before it can be paid.' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wfp_vendor_payment_match_guard
  BEFORE INSERT ON "VendorPayment"
  FOR EACH ROW EXECUTE FUNCTION wfp_guard_vendor_payment_match();
