-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "closeChecklistRequired" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "PeriodSnapshot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "asAt" DATE NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "takenBy" TEXT NOT NULL,
    "takenByUserId" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "arTotal" DECIMAL(16,2) NOT NULL,
    "arLedger" DECIMAL(16,2) NOT NULL,
    "apTotal" DECIMAL(16,2) NOT NULL,
    "apLedger" DECIMAL(16,2) NOT NULL,
    "trialDebit" DECIMAL(16,2) NOT NULL,
    "trialCredit" DECIMAL(16,2) NOT NULL,
    "checksum" TEXT NOT NULL,
    "supersededAt" TIMESTAMP(3),
    "supersededBy" TEXT,

    CONSTRAINT "PeriodSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CloseChecklistItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "doneBy" TEXT,
    "doneByUserId" TEXT,
    "doneAt" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "CloseChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CloseWaiver" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "checkCode" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "waivedBy" TEXT NOT NULL,
    "waivedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CloseWaiver_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PeriodSnapshot_organizationId_periodId_idx" ON "PeriodSnapshot"("organizationId", "periodId");

-- CreateIndex
CREATE UNIQUE INDEX "PeriodSnapshot_periodId_version_key" ON "PeriodSnapshot"("periodId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "CloseChecklistItem_periodId_code_key" ON "CloseChecklistItem"("periodId", "code");

-- CreateIndex
CREATE INDEX "CloseWaiver_periodId_idx" ON "CloseWaiver"("periodId");

-- AddForeignKey
ALTER TABLE "PeriodSnapshot" ADD CONSTRAINT "PeriodSnapshot_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "AccountingPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CloseChecklistItem" ADD CONSTRAINT "CloseChecklistItem_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "AccountingPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CloseWaiver" ADD CONSTRAINT "CloseWaiver_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "AccountingPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A period snapshot is the official record of the books at close. Nothing in it can be changed or removed, not even by SQL; the only
-- thing that ever happens to one is being superseded (once) when its period is reopened and closed again.
CREATE OR REPLACE FUNCTION wfp_protect_period_snapshots() RETURNS trigger AS $$
BEGIN
  IF current_setting('wfp.allow_ledger_reset', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A period snapshot cannot be deleted.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."periodId" IS DISTINCT FROM OLD."periodId" OR NEW.version IS DISTINCT FROM OLD.version OR NEW."asAt" IS DISTINCT FROM OLD."asAt"
     OR NEW.data IS DISTINCT FROM OLD.data OR NEW."arTotal" IS DISTINCT FROM OLD."arTotal" OR NEW."arLedger" IS DISTINCT FROM OLD."arLedger"
     OR NEW."apTotal" IS DISTINCT FROM OLD."apTotal" OR NEW."apLedger" IS DISTINCT FROM OLD."apLedger"
     OR NEW."trialDebit" IS DISTINCT FROM OLD."trialDebit" OR NEW."trialCredit" IS DISTINCT FROM OLD."trialCredit"
     OR NEW.checksum IS DISTINCT FROM OLD.checksum OR NEW."takenAt" IS DISTINCT FROM OLD."takenAt" OR NEW."takenBy" IS DISTINCT FROM OLD."takenBy" THEN
    RAISE EXCEPTION 'A period snapshot cannot be changed.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."supersededAt" IS NOT NULL AND NEW."supersededAt" IS DISTINCT FROM OLD."supersededAt" THEN
    RAISE EXCEPTION 'A period snapshot is superseded only once.' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wfp_period_snapshot_protected
  BEFORE UPDATE OR DELETE ON "PeriodSnapshot"
  FOR EACH ROW EXECUTE FUNCTION wfp_protect_period_snapshots();

-- A waiver is a record of a decision. It is never changed or removed.
CREATE OR REPLACE FUNCTION wfp_protect_close_waivers() RETURNS trigger AS $$
BEGIN
  IF current_setting('wfp.allow_ledger_reset', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'A close waiver cannot be changed or deleted.' USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wfp_close_waiver_protected
  BEFORE UPDATE OR DELETE ON "CloseWaiver"
  FOR EACH ROW EXECUTE FUNCTION wfp_protect_close_waivers();
