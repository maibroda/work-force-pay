-- CreateEnum
CREATE TYPE "TimeEntryStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "DayClass" AS ENUM ('WEEKDAY', 'WEEKEND', 'HOLIDAY');

-- CreateTable
CREATE TABLE "TimeEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "beatId" TEXT NOT NULL,
    "clockIn" TIMESTAMP(3) NOT NULL,
    "clockOut" TIMESTAMP(3),
    "status" "TimeEntryStatus" NOT NULL DEFAULT 'DRAFT',
    "correctsId" TEXT,
    "reason" TEXT,
    "capturedBy" TEXT NOT NULL,
    "capturedByUserId" TEXT NOT NULL,
    "completedBy" TEXT,
    "completedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "decidedBy" TEXT,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "placeState" TEXT,
    "calendarConfirmed" BOOLEAN,
    "payableMinutes" INTEGER,

    CONSTRAINT "TimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeEntryBreak" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimeEntryBreak_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeEntrySegment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "dayClass" "DayClass" NOT NULL,
    "minutes" INTEGER NOT NULL,

    CONSTRAINT "TimeEntrySegment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TimeEntry_organizationId_employeeId_clockIn_idx" ON "TimeEntry"("organizationId", "employeeId", "clockIn");

-- CreateIndex
CREATE INDEX "TimeEntry_organizationId_status_idx" ON "TimeEntry"("organizationId", "status");

-- CreateIndex
CREATE INDEX "TimeEntry_organizationId_beatId_clockIn_idx" ON "TimeEntry"("organizationId", "beatId", "clockIn");

-- CreateIndex
CREATE INDEX "TimeEntryBreak_entryId_idx" ON "TimeEntryBreak"("entryId");

-- CreateIndex
CREATE INDEX "TimeEntrySegment_organizationId_date_idx" ON "TimeEntrySegment"("organizationId", "date");

-- CreateIndex
CREATE INDEX "TimeEntrySegment_entryId_idx" ON "TimeEntrySegment"("entryId");

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_beatId_fkey" FOREIGN KEY ("beatId") REFERENCES "Beat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_correctsId_fkey" FOREIGN KEY ("correctsId") REFERENCES "TimeEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntryBreak" ADD CONSTRAINT "TimeEntryBreak_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "TimeEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntrySegment" ADD CONSTRAINT "TimeEntrySegment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntrySegment" ADD CONSTRAINT "TimeEntrySegment_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "TimeEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hourly pay, phase 3 (docs/plans/hourly-payroll-phase3-explain-back.md). Everything above is new and additive: no existing table or row is changed, and nothing reads these tables in the pay run yet.

-- Times are whole minutes, a shift ends after it starts, a shift that is submitted or approved has its clock-out, and an approved shift was approved by someone other than the person who captured it or who entered its clock-out.
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_whole_minutes_check" CHECK (date_trunc('minute', "clockIn") = "clockIn" AND ("clockOut" IS NULL OR date_trunc('minute', "clockOut") = "clockOut"));
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_order_check" CHECK ("clockOut" IS NULL OR "clockOut" > "clockIn");
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_complete_check" CHECK ("status" NOT IN ('SUBMITTED', 'APPROVED', 'SUPERSEDED') OR "clockOut" IS NOT NULL);
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_approved_check" CHECK ("status" NOT IN ('APPROVED', 'SUPERSEDED') OR ("payableMinutes" IS NOT NULL AND "payableMinutes" >= 0 AND "decidedByUserId" IS NOT NULL AND "decidedByUserId" <> "capturedByUserId" AND ("completedByUserId" IS NULL OR "decidedByUserId" <> "completedByUserId")));
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_not_self_correcting_check" CHECK ("correctsId" IS NULL OR "correctsId" <> "id");
ALTER TABLE "TimeEntryBreak" ADD CONSTRAINT "TimeEntryBreak_order_check" CHECK ("endsAt" > "startsAt");
ALTER TABLE "TimeEntrySegment" ADD CONSTRAINT "TimeEntrySegment_minutes_check" CHECK ("minutes" BETWEEN 1 AND 1440);

-- A time entry is kept for the record: never deleted. A rejected, withdrawn or superseded entry never changes again. An approved entry changes only to become superseded by a correction. Once an entry has
-- left DRAFT its times, person and place never change (a DRAFT may get its clock-out).
CREATE FUNCTION wfp_time_entry_protect() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A time entry is kept for the record and cannot be deleted; withdraw it, or correct it with a new entry.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."status" IN ('REJECTED', 'WITHDRAWN', 'SUPERSEDED') THEN
    RAISE EXCEPTION 'A time entry that is % cannot be changed.', lower(OLD."status"::text) USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."status" = 'APPROVED' AND NEW."status" IS DISTINCT FROM 'SUPERSEDED' THEN
    RAISE EXCEPTION 'An approved time entry cannot be changed; correct it with a new entry.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."status" <> 'DRAFT' AND (
       NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
    OR NEW."employeeId" IS DISTINCT FROM OLD."employeeId"
    OR NEW."clientId" IS DISTINCT FROM OLD."clientId"
    OR NEW."contractId" IS DISTINCT FROM OLD."contractId"
    OR NEW."beatId" IS DISTINCT FROM OLD."beatId"
    OR NEW."clockIn" IS DISTINCT FROM OLD."clockIn"
    OR NEW."clockOut" IS DISTINCT FROM OLD."clockOut"
    OR NEW."correctsId" IS DISTINCT FROM OLD."correctsId"
    OR NEW."capturedByUserId" IS DISTINCT FROM OLD."capturedByUserId"
    OR NEW."completedByUserId" IS DISTINCT FROM OLD."completedByUserId"
  ) THEN
    RAISE EXCEPTION 'The times, person and place of a submitted time entry cannot be changed.' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wfp_time_entry_protected
  BEFORE UPDATE OR DELETE ON "TimeEntry"
  FOR EACH ROW EXECUTE FUNCTION wfp_time_entry_protect();

-- The breaks and the paid pieces of a shift are written once, at approval, and never changed or deleted.
CREATE FUNCTION wfp_time_entry_children_protect() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'The breaks and paid pieces of a time entry are kept for the record and cannot be changed or deleted; correct the entry with a new one.' USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wfp_time_entry_break_protected
  BEFORE UPDATE OR DELETE ON "TimeEntryBreak"
  FOR EACH ROW EXECUTE FUNCTION wfp_time_entry_children_protect();

CREATE TRIGGER wfp_time_entry_segment_protected
  BEFORE UPDATE OR DELETE ON "TimeEntrySegment"
  FOR EACH ROW EXECUTE FUNCTION wfp_time_entry_children_protect();
