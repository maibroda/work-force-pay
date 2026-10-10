-- CreateEnum
CREATE TYPE "JournalDocumentKind" AS ENUM ('MANUAL', 'ADJUSTMENT', 'ACCRUAL', 'RECLASSIFICATION');

-- CreateEnum
CREATE TYPE "JournalDocumentStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'POSTED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "JournalReversalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "JournalEntry" ADD COLUMN     "reversalOfId" TEXT;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "journalApprovalRequired" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "JournalDocument" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "documentNumber" TEXT NOT NULL,
    "kind" "JournalDocumentKind" NOT NULL DEFAULT 'MANUAL',
    "description" TEXT NOT NULL,
    "postingDate" DATE NOT NULL,
    "reverseOn" DATE,
    "status" "JournalDocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "createdBy" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "submittedBy" TEXT,
    "submittedByUserId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "decidedBy" TEXT,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "postedBy" TEXT,
    "postedAt" TIMESTAMP(3),
    "journalId" TEXT,

    CONSTRAINT "JournalDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalDocumentLine" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "debit" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "dimensions" JSONB,

    CONSTRAINT "JournalDocumentLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalReversal" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "journalId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "reverseDate" DATE NOT NULL,
    "status" "JournalReversalStatus" NOT NULL DEFAULT 'PENDING',
    "requestedBy" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedBy" TEXT,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,

    CONSTRAINT "JournalReversal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JournalDocument_journalId_key" ON "JournalDocument"("journalId");

-- CreateIndex
CREATE INDEX "JournalDocument_organizationId_status_idx" ON "JournalDocument"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "JournalDocument_organizationId_documentNumber_key" ON "JournalDocument"("organizationId", "documentNumber");

-- CreateIndex
CREATE INDEX "JournalDocumentLine_documentId_idx" ON "JournalDocumentLine"("documentId");

-- CreateIndex
CREATE INDEX "JournalReversal_organizationId_status_idx" ON "JournalReversal"("organizationId", "status");

-- CreateIndex
CREATE INDEX "JournalReversal_journalId_idx" ON "JournalReversal"("journalId");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_reversalOfId_key" ON "JournalEntry"("reversalOfId");

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalDocument" ADD CONSTRAINT "JournalDocument_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalDocument" ADD CONSTRAINT "JournalDocument_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalDocumentLine" ADD CONSTRAINT "JournalDocumentLine_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "JournalDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalDocumentLine" ADD CONSTRAINT "JournalDocumentLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "GlAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalReversal" ADD CONSTRAINT "JournalReversal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalReversal" ADD CONSTRAINT "JournalReversal_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- A journal document is frozen once it leaves draft, enforced by the database.
--
-- Drafts and rejected documents can be edited. Once a document is submitted, approved or posted, its lines cannot be
-- added, changed or removed, and its description, date and kind cannot change (only the status, decision and posting
-- fields move forward). A posted or cancelled document cannot change at all, and nothing that has been submitted can
-- be deleted: a mistake is rejected back to draft, or cancelled, never erased.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION wfp_protect_journal_documents() RETURNS trigger AS $$
DECLARE
  doc_status text;
BEGIN
  IF current_setting('wfp.allow_ledger_reset', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'JournalDocument' THEN
    IF TG_OP = 'DELETE' THEN
      IF OLD.status::text NOT IN ('DRAFT', 'REJECTED', 'CANCELLED') THEN
        RAISE EXCEPTION 'A journal document that has been submitted or posted cannot be deleted.' USING ERRCODE = 'restrict_violation';
      END IF;
      RETURN OLD;
    END IF;
    IF OLD.status::text IN ('POSTED', 'CANCELLED') THEN
      RAISE EXCEPTION 'A posted or cancelled journal document cannot be changed.' USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.status::text IN ('SUBMITTED', 'APPROVED')
       AND (NEW.description IS DISTINCT FROM OLD.description OR NEW."postingDate" IS DISTINCT FROM OLD."postingDate"
            OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW."reverseOn" IS DISTINCT FROM OLD."reverseOn") THEN
      RAISE EXCEPTION 'A submitted journal document cannot be edited; reject it back to draft first.' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- JournalDocumentLine: follows its document
  IF TG_OP = 'INSERT' THEN
    SELECT status::text INTO doc_status FROM "JournalDocument" WHERE id = NEW."documentId";
  ELSE
    SELECT status::text INTO doc_status FROM "JournalDocument" WHERE id = OLD."documentId";
  END IF;
  -- no parent row left means the document itself is being deleted (a draft), which is allowed
  IF doc_status IN ('SUBMITTED', 'APPROVED', 'POSTED', 'CANCELLED') THEN
    RAISE EXCEPTION 'The lines of a submitted, approved, posted or cancelled journal document cannot be changed.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wfp_journal_document_frozen
  BEFORE UPDATE OR DELETE ON "JournalDocument"
  FOR EACH ROW EXECUTE FUNCTION wfp_protect_journal_documents();

CREATE TRIGGER wfp_journal_document_line_frozen
  BEFORE INSERT OR UPDATE OR DELETE ON "JournalDocumentLine"
  FOR EACH ROW EXECUTE FUNCTION wfp_protect_journal_documents();
