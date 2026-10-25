-- CreateEnum
CREATE TYPE "ClientInputStatus" AS ENUM ('SUBMITTED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "ClientInputBatch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "status" "ClientInputStatus" NOT NULL DEFAULT 'SUBMITTED',
    "rowCount" INTEGER NOT NULL,
    "warningCount" INTEGER NOT NULL DEFAULT 0,
    "earningsTotal" DECIMAL(14,2) NOT NULL,
    "deductionsTotal" DECIMAL(14,2) NOT NULL,
    "late" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "markedKinds" TEXT[],
    "submittedBy" TEXT NOT NULL,
    "submittedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedBy" TEXT,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,

    CONSTRAINT "ClientInputBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientInputRow" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "line" INTEGER NOT NULL,
    "employeeId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "taxable" BOOLEAN NOT NULL DEFAULT true,
    "reference" TEXT,
    "note" TEXT,
    "warnings" TEXT[],
    "appliedKind" TEXT,
    "appliedId" TEXT,

    CONSTRAINT "ClientInputRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientInputBatch_organizationId_periodId_status_idx" ON "ClientInputBatch"("organizationId", "periodId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ClientInputBatch_organizationId_number_key" ON "ClientInputBatch"("organizationId", "number");

-- CreateIndex
CREATE INDEX "ClientInputRow_batchId_idx" ON "ClientInputRow"("batchId");

-- CreateIndex
CREATE INDEX "ClientInputRow_organizationId_employeeId_idx" ON "ClientInputRow"("organizationId", "employeeId");

-- AddForeignKey
ALTER TABLE "ClientInputBatch" ADD CONSTRAINT "ClientInputBatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientInputBatch" ADD CONSTRAINT "ClientInputBatch_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "PayrollPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientInputRow" ADD CONSTRAINT "ClientInputRow_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientInputRow" ADD CONSTRAINT "ClientInputRow_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ClientInputBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientInputRow" ADD CONSTRAINT "ClientInputRow_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- Client input uploads. What a client sent is kept exactly as sent: rows can't be changed or removed (the only thing added later is what an
-- accepted row became), a batch is decided once, and the person who sent it can't be the one who accepts it.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE "ClientInputRow" ADD CONSTRAINT "ClientInputRow_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "ClientInputRow" ADD CONSTRAINT "ClientInputRow_type_known" CHECK ("type" IN ('OVERTIME', 'ALLOWANCE', 'BONUS', 'OTHER_EARNING', 'DEDUCTION', 'PENALTY', 'RECOVERY', 'SALARY_ADVANCE'));
-- a deduction needs the reference to the authority for it, as a deduction entered by hand does
ALTER TABLE "ClientInputRow" ADD CONSTRAINT "ClientInputRow_deduction_reference" CHECK ("type" IN ('OVERTIME', 'ALLOWANCE', 'BONUS', 'OTHER_EARNING') OR length(btrim(coalesce("reference", ''))) >= 3);
ALTER TABLE "ClientInputBatch" ADD CONSTRAINT "ClientInputBatch_rows_positive" CHECK ("rowCount" > 0);

CREATE OR REPLACE FUNCTION wfp_client_input_batch_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A client input upload cannot be deleted.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."status" <> 'SUBMITTED' THEN
    RAISE EXCEPTION 'This upload has already been decided and cannot change.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId" OR NEW."periodId" IS DISTINCT FROM OLD."periodId"
     OR NEW."number" IS DISTINCT FROM OLD."number" OR NEW."fileName" IS DISTINCT FROM OLD."fileName" OR NEW."checksum" IS DISTINCT FROM OLD."checksum"
     OR NEW."rowCount" IS DISTINCT FROM OLD."rowCount" OR NEW."warningCount" IS DISTINCT FROM OLD."warningCount"
     OR NEW."earningsTotal" IS DISTINCT FROM OLD."earningsTotal" OR NEW."deductionsTotal" IS DISTINCT FROM OLD."deductionsTotal"
     OR NEW."late" IS DISTINCT FROM OLD."late" OR NEW."note" IS DISTINCT FROM OLD."note" OR NEW."markedKinds" IS DISTINCT FROM OLD."markedKinds"
     OR NEW."submittedBy" IS DISTINCT FROM OLD."submittedBy" OR NEW."submittedByUserId" IS DISTINCT FROM OLD."submittedByUserId"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'What a client sent cannot be changed.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."status" = 'SUBMITTED' THEN
    RAISE EXCEPTION 'An upload can only be decided, not edited.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."decidedBy" IS NULL OR NEW."decidedByUserId" IS NULL OR NEW."decidedAt" IS NULL THEN
    RAISE EXCEPTION 'A decision needs who made it and when.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."status" = 'ACCEPTED' AND NEW."decidedByUserId" = OLD."submittedByUserId" THEN
    RAISE EXCEPTION 'Whoever sent an upload cannot be the one to accept it.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."status" = 'REJECTED' AND length(btrim(coalesce(NEW."decisionNote", ''))) < 5 THEN
    RAISE EXCEPTION 'Refusing an upload needs a reason.' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wfp_client_input_batch_guard BEFORE UPDATE OR DELETE ON "ClientInputBatch"
  FOR EACH ROW EXECUTE FUNCTION wfp_client_input_batch_guard();

CREATE OR REPLACE FUNCTION wfp_client_input_row_guard() RETURNS trigger AS $$
DECLARE b RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A client input row cannot be deleted.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT "status", "organizationId" INTO b FROM "ClientInputBatch" WHERE "id" = NEW."batchId";
    IF b."status" <> 'SUBMITTED' THEN
      RAISE EXCEPTION 'Rows cannot be added to an upload that has been decided.' USING ERRCODE = 'restrict_violation';
    END IF;
    IF b."organizationId" <> NEW."organizationId" THEN
      RAISE EXCEPTION 'A row belongs to the same organization as its upload.' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  -- update: only what the row became may be filled in, once
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId" OR NEW."batchId" IS DISTINCT FROM OLD."batchId"
     OR NEW."line" IS DISTINCT FROM OLD."line" OR NEW."employeeId" IS DISTINCT FROM OLD."employeeId" OR NEW."type" IS DISTINCT FROM OLD."type"
     OR NEW."description" IS DISTINCT FROM OLD."description" OR NEW."amount" IS DISTINCT FROM OLD."amount" OR NEW."taxable" IS DISTINCT FROM OLD."taxable"
     OR NEW."reference" IS DISTINCT FROM OLD."reference" OR NEW."note" IS DISTINCT FROM OLD."note" OR NEW."warnings" IS DISTINCT FROM OLD."warnings" THEN
    RAISE EXCEPTION 'What a client sent cannot be changed.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."appliedId" IS NOT NULL THEN
    RAISE EXCEPTION 'This row has already been applied.' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wfp_client_input_row_guard BEFORE INSERT OR UPDATE OR DELETE ON "ClientInputRow"
  FOR EACH ROW EXECUTE FUNCTION wfp_client_input_row_guard();
