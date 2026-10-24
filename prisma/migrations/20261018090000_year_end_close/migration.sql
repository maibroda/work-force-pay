-- AlterTable
ALTER TABLE "FiscalYear" ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "closedBy" TEXT,
ADD COLUMN     "closedByUserId" TEXT,
ADD COLUMN     "closingJournalId" TEXT,
ADD COLUMN     "retainedEarningsAccountId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "FiscalYear_closingJournalId_key" ON "FiscalYear"("closingJournalId");

-- AddForeignKey
ALTER TABLE "FiscalYear" ADD CONSTRAINT "FiscalYear_closingJournalId_fkey" FOREIGN KEY ("closingJournalId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Once a year has been closed (its closing journal posted) the link can't be quietly cut: a closed year is reopened by reversing
-- its closing journal, which clears the fields in the same transaction. Closing fields only ever move together.
CREATE OR REPLACE FUNCTION wfp_guard_fiscal_year_close() RETURNS trigger AS $$
BEGIN
  IF current_setting('wfp.allow_ledger_reset', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF (NEW."closedAt" IS NULL) <> (NEW."closingJournalId" IS NULL) THEN
    RAISE EXCEPTION 'A financial year is closed with its closing journal, or not closed at all.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."closingJournalId" IS NOT NULL AND NEW."closingJournalId" IS NOT NULL AND NEW."closingJournalId" IS DISTINCT FROM OLD."closingJournalId" THEN
    RAISE EXCEPTION 'The closing journal of a closed year cannot be swapped; reopen the year first.' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wfp_fiscal_year_close_guard
  BEFORE UPDATE ON "FiscalYear"
  FOR EACH ROW EXECUTE FUNCTION wfp_guard_fiscal_year_close();
