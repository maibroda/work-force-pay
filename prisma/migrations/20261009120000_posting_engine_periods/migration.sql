-- CreateEnum
CREATE TYPE "AccountingPeriodStatus" AS ENUM ('OPEN', 'SOFT_CLOSED', 'CLOSED', 'LOCKED');

-- AlterTable
ALTER TABLE "JournalEntry" ADD COLUMN     "periodId" TEXT,
ADD COLUMN     "sourceId" TEXT,
ADD COLUMN     "sourceType" TEXT;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "fiscalYearStartMonth" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "FiscalYear" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FiscalYear_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountingPeriod" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fiscalYearId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" "AccountingPeriodStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountingPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountingPeriodEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "fromStatus" "AccountingPeriodStatus" NOT NULL,
    "toStatus" "AccountingPeriodStatus" NOT NULL,
    "actor" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountingPeriodEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FiscalYear_organizationId_startDate_key" ON "FiscalYear"("organizationId", "startDate");

-- CreateIndex
CREATE INDEX "AccountingPeriod_organizationId_status_idx" ON "AccountingPeriod"("organizationId", "status");

-- CreateIndex
CREATE INDEX "AccountingPeriod_fiscalYearId_idx" ON "AccountingPeriod"("fiscalYearId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingPeriod_organizationId_startDate_key" ON "AccountingPeriod"("organizationId", "startDate");

-- CreateIndex
CREATE INDEX "AccountingPeriodEvent_periodId_idx" ON "AccountingPeriodEvent"("periodId");

-- CreateIndex
CREATE INDEX "JournalEntry_organizationId_sourceType_sourceId_idx" ON "JournalEntry"("organizationId", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "JournalEntry_periodId_idx" ON "JournalEntry"("periodId");

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "AccountingPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalYear" ADD CONSTRAINT "FiscalYear_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingPeriod" ADD CONSTRAINT "AccountingPeriod_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingPeriod" ADD CONSTRAINT "AccountingPeriod_fiscalYearId_fkey" FOREIGN KEY ("fiscalYearId") REFERENCES "FiscalYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingPeriodEvent" ADD CONSTRAINT "AccountingPeriodEvent_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "AccountingPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- Posted journals are immutable, enforced by the database and not only by the application.
--
-- A posted journal and its lines can never be deleted, and its lines can never be changed. The only change a
-- journal header accepts is a one-time stamp of the accounting period and source-document reference on an older
-- journal that was posted before those columns existed (a column that is still NULL may be set once; nothing that
-- already has a value may change). A correction is a new, reversing journal.
--
-- TRUNCATE is not intercepted by row triggers, so the seed script's full reset still works. For a deliberate
-- ledger reset in a disposable database, a session may set  wfp.allow_ledger_reset = 'on'.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION wfp_protect_posted_journals() RETURNS trigger AS $$
BEGIN
  IF current_setting('wfp.allow_ledger_reset', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A posted journal cannot be deleted; reverse it with a new entry instead.' USING ERRCODE = 'restrict_violation';
  END IF;

  IF TG_TABLE_NAME = 'JournalLine' THEN
    RAISE EXCEPTION 'The lines of a posted journal cannot be changed; reverse the journal with a new entry instead.' USING ERRCODE = 'restrict_violation';
  END IF;

  -- JournalEntry: everything except the three stamp columns must be unchanged ...
  IF (to_jsonb(NEW) - 'periodId' - 'sourceType' - 'sourceId') IS DISTINCT FROM (to_jsonb(OLD) - 'periodId' - 'sourceType' - 'sourceId')
     -- ... and a stamp column that already has a value must not change.
     OR (OLD."periodId" IS NOT NULL AND NEW."periodId" IS DISTINCT FROM OLD."periodId")
     OR (OLD."sourceType" IS NOT NULL AND NEW."sourceType" IS DISTINCT FROM OLD."sourceType")
     OR (OLD."sourceId" IS NOT NULL AND NEW."sourceId" IS DISTINCT FROM OLD."sourceId") THEN
    RAISE EXCEPTION 'A posted journal cannot be edited; reverse it with a new entry instead.' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wfp_journal_entry_immutable
  BEFORE UPDATE OR DELETE ON "JournalEntry"
  FOR EACH ROW EXECUTE FUNCTION wfp_protect_posted_journals();

CREATE TRIGGER wfp_journal_line_immutable
  BEFORE UPDATE OR DELETE ON "JournalLine"
  FOR EACH ROW EXECUTE FUNCTION wfp_protect_posted_journals();
