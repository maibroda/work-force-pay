-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "InvoiceStatus" ADD VALUE 'DRAFT';
ALTER TYPE "InvoiceStatus" ADD VALUE 'SUBMITTED';

-- AlterTable
ALTER TABLE "ClientInvoice" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedBy" TEXT,
ADD COLUMN     "approvedByUserId" TEXT,
ADD COLUMN     "generatedByUserId" TEXT,
ADD COLUMN     "rejectionNote" TEXT,
ADD COLUMN     "sentAt" TIMESTAMP(3),
ADD COLUMN     "sentBy" TEXT,
ADD COLUMN     "sentVia" TEXT,
ADD COLUMN     "submittedAt" TIMESTAMP(3),
ADD COLUMN     "submittedBy" TEXT,
ADD COLUMN     "submittedByUserId" TEXT;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "invoiceApprovalRequired" BOOLEAN NOT NULL DEFAULT false;


-- A posted invoice is history. Once an invoice has left DRAFT/SUBMITTED, what it says (client, dates, amounts, the rules and rates it
-- was calculated with) can never change, it can't go back to a draft, and it can't be deleted, not even by SQL. What does move after
-- posting is what settles it (payments, deductions, credit and debit notes), its status, the note on it and when it was sent. A
-- draft can be edited and discarded freely: it is not in the ledger.
CREATE OR REPLACE FUNCTION wfp_protect_client_invoices() RETURNS trigger AS $$
BEGIN
  IF current_setting('wfp.allow_ledger_reset', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.status::text <> 'DRAFT' THEN
      RAISE EXCEPTION 'An invoice that has been submitted or posted cannot be deleted; cancel it instead.' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status::text IN ('DRAFT', 'SUBMITTED') THEN
    RETURN NEW;
  END IF;
  IF NEW.status::text IN ('DRAFT', 'SUBMITTED') THEN
    RAISE EXCEPTION 'A posted invoice cannot go back to a draft.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status::text = 'CANCELLED' AND (NEW.status IS DISTINCT FROM OLD.status OR NEW."amountPaid" IS DISTINCT FROM OLD."amountPaid") THEN
    RAISE EXCEPTION 'A cancelled invoice cannot change.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId" OR NEW."clientId" IS DISTINCT FROM OLD."clientId"
     OR NEW."runId" IS DISTINCT FROM OLD."runId" OR NEW."periodId" IS DISTINCT FROM OLD."periodId"
     OR NEW."invoiceNumber" IS DISTINCT FROM OLD."invoiceNumber" OR NEW."invoiceDate" IS DISTINCT FROM OLD."invoiceDate"
     OR NEW."dueDate" IS DISTINCT FROM OLD."dueDate" OR NEW.subtotal IS DISTINCT FROM OLD.subtotal
     OR NEW."directChargePct" IS DISTINCT FROM OLD."directChargePct" OR NEW."indirectChargePct" IS DISTINCT FROM OLD."indirectChargePct"
     OR NEW."totalDirectCharge" IS DISTINCT FROM OLD."totalDirectCharge" OR NEW."totalIndirectCharge" IS DISTINCT FROM OLD."totalIndirectCharge"
     OR NEW."vatPct" IS DISTINCT FROM OLD."vatPct" OR NEW."vatAmount" IS DISTINCT FROM OLD."vatAmount"
     OR NEW."whtPct" IS DISTINCT FROM OLD."whtPct" OR NEW."whtAmount" IS DISTINCT FROM OLD."whtAmount"
     OR NEW."totalAmount" IS DISTINCT FROM OLD."totalAmount" OR NEW."taxBasis" IS DISTINCT FROM OLD."taxBasis"
     OR NEW."createdBy" IS DISTINCT FROM OLD."createdBy" THEN
    RAISE EXCEPTION 'A posted invoice cannot be edited; put it right with a credit or debit note, or cancel it.' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wfp_client_invoice_protected
  BEFORE UPDATE OR DELETE ON "ClientInvoice"
  FOR EACH ROW EXECUTE FUNCTION wfp_protect_client_invoices();

-- The lines follow their invoice: frozen once it is posted.
CREATE OR REPLACE FUNCTION wfp_protect_client_invoice_lines() RETURNS trigger AS $$
DECLARE
  inv_status text;
BEGIN
  IF current_setting('wfp.allow_ledger_reset', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  SELECT status::text INTO inv_status FROM "ClientInvoice" WHERE id = OLD."invoiceId";
  -- no parent row left means the invoice itself is being deleted (a draft), which is allowed
  IF inv_status IS NOT NULL AND inv_status NOT IN ('DRAFT', 'SUBMITTED') THEN
    RAISE EXCEPTION 'The lines of a posted invoice cannot be changed or removed.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wfp_client_invoice_line_protected
  BEFORE UPDATE OR DELETE ON "ClientInvoiceLine"
  FOR EACH ROW EXECUTE FUNCTION wfp_protect_client_invoice_lines();
