-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "importBatchId" TEXT;

-- CreateTable
CREATE TABLE "EmployeeImportBatch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "importedCount" INTEGER NOT NULL,
    "skippedCount" INTEGER NOT NULL,
    "warningCount" INTEGER NOT NULL,
    "outcomes" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmployeeImportBatch_organizationId_createdAt_idx" ON "EmployeeImportBatch"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "EmployeeImportBatch" ADD CONSTRAINT "EmployeeImportBatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "EmployeeImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;



ALTER TABLE "EmployeeImportBatch" ADD CONSTRAINT "EmployeeImportBatch_counts_consistent" CHECK ("importedCount" >= 0 AND "skippedCount" >= 0 AND "importedCount" + "skippedCount" = "rowCount");

-- An import batch is the record of what was loaded and by whom. It is never changed or removed.
CREATE OR REPLACE FUNCTION wfp_protect_employee_import_batches() RETURNS trigger AS $$
BEGIN
  IF current_setting('wfp.allow_ledger_reset', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'An employee import record cannot be changed or deleted.' USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wfp_employee_import_batch_protected
  BEFORE UPDATE OR DELETE ON "EmployeeImportBatch"
  FOR EACH ROW EXECUTE FUNCTION wfp_protect_employee_import_batches();
