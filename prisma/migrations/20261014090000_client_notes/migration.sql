-- CreateEnum
CREATE TYPE "ClientNoteType" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "ClientNoteReason" AS ENUM ('BILLING_ERROR', 'SERVICE_CREDIT', 'DISCOUNT', 'PRICE_ADJUSTMENT', 'PENALTY_OR_FEE', 'OTHER');

-- CreateEnum
CREATE TYPE "NoteStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "ClientInvoice" ADD COLUMN     "totalCredits" DECIMAL(16,2) NOT NULL DEFAULT 0,
ADD COLUMN     "totalDebits" DECIMAL(16,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ClientNote" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "noteNumber" TEXT NOT NULL,
    "type" "ClientNoteType" NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "noteDate" DATE NOT NULL,
    "reasonCode" "ClientNoteReason" NOT NULL,
    "reason" TEXT NOT NULL,
    "netAmount" DECIMAL(16,2) NOT NULL,
    "vatAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(16,2) NOT NULL,
    "status" "NoteStatus" NOT NULL DEFAULT 'PENDING',
    "requestedBy" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedBy" TEXT,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,

    CONSTRAINT "ClientNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientNote_organizationId_status_idx" ON "ClientNote"("organizationId", "status");

-- CreateIndex
CREATE INDEX "ClientNote_invoiceId_idx" ON "ClientNote"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientNote_organizationId_noteNumber_key" ON "ClientNote"("organizationId", "noteNumber");

-- AddForeignKey
ALTER TABLE "ClientNote" ADD CONSTRAINT "ClientNote_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientNote" ADD CONSTRAINT "ClientNote_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "ClientInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientNote" ADD CONSTRAINT "ClientNote_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A note adds up: net plus VAT is the total, and none of them is negative.
ALTER TABLE "ClientNote" ADD CONSTRAINT "ClientNote_amounts" CHECK ("netAmount" > 0 AND "vatAmount" >= 0 AND "totalAmount" = "netAmount" + "vatAmount");

-- Once a credit or debit note has been decided it is history: nothing about it can change, and it can't be deleted. A note
-- still waiting can be decided (approved or turned down) but not reworded.
CREATE OR REPLACE FUNCTION wfp_protect_client_notes() RETURNS trigger AS $$
BEGIN
  IF current_setting('wfp.allow_ledger_reset', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A credit or debit note cannot be deleted.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status::text <> 'PENDING' THEN
    RAISE EXCEPTION 'A credit or debit note that has been decided cannot be changed.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."netAmount" IS DISTINCT FROM OLD."netAmount" OR NEW."vatAmount" IS DISTINCT FROM OLD."vatAmount"
     OR NEW."totalAmount" IS DISTINCT FROM OLD."totalAmount" OR NEW."invoiceId" IS DISTINCT FROM OLD."invoiceId"
     OR NEW.type IS DISTINCT FROM OLD.type OR NEW."noteDate" IS DISTINCT FROM OLD."noteDate"
     OR NEW.reason IS DISTINCT FROM OLD.reason OR NEW."reasonCode" IS DISTINCT FROM OLD."reasonCode"
     OR NEW."requestedByUserId" IS DISTINCT FROM OLD."requestedByUserId" THEN
    RAISE EXCEPTION 'A credit or debit note cannot be edited; withdraw it and raise another.' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wfp_client_note_protected
  BEFORE UPDATE OR DELETE ON "ClientNote"
  FOR EACH ROW EXECUTE FUNCTION wfp_protect_client_notes();
