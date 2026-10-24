-- CreateEnum
CREATE TYPE "InputItemStatus" AS ENUM ('EXPECTED', 'RECEIVED', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "InputIssueStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateTable
CREATE TABLE "PayrollCalendarSetting" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "inputCutoffDay" INTEGER NOT NULL DEFAULT 20,
    "draftWorkingDays" INTEGER NOT NULL DEFAULT 3,
    "approvalWorkingDays" INTEGER NOT NULL DEFAULT 2,
    "payDayOfMonth" INTEGER NOT NULL DEFAULT 28,
    "remittanceDueDay" INTEGER NOT NULL DEFAULT 10,
    "expectedInputs" TEXT[] DEFAULT ARRAY['ATTENDANCE', 'OVERTIME', 'ALLOWANCES', 'DEDUCTIONS', 'LOANS', 'JOINERS_LEAVERS']::TEXT[],
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollCalendarSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollCalendarEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "inputCutoff" DATE NOT NULL,
    "draftDue" DATE NOT NULL,
    "approvalDue" DATE NOT NULL,
    "payDate" DATE NOT NULL,
    "remittanceDue" DATE NOT NULL,
    "adjusted" BOOLEAN NOT NULL DEFAULT false,
    "adjustReason" TEXT,
    "adjustedBy" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollCalendarEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollInputItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" "InputItemStatus" NOT NULL DEFAULT 'EXPECTED',
    "receivedAt" TIMESTAMP(3),
    "markedBy" TEXT,
    "markedByUserId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollInputItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollInputIssue" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "kind" TEXT,
    "description" TEXT NOT NULL,
    "status" "InputIssueStatus" NOT NULL DEFAULT 'OPEN',
    "raisedBy" TEXT NOT NULL,
    "raisedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolution" TEXT,

    CONSTRAINT "PayrollInputIssue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PayrollCalendarSetting_organizationId_key" ON "PayrollCalendarSetting"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollCalendarEntry_periodId_key" ON "PayrollCalendarEntry"("periodId");

-- CreateIndex
CREATE INDEX "PayrollCalendarEntry_organizationId_idx" ON "PayrollCalendarEntry"("organizationId");

-- CreateIndex
CREATE INDEX "PayrollInputItem_organizationId_status_idx" ON "PayrollInputItem"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollInputItem_periodId_kind_key" ON "PayrollInputItem"("periodId", "kind");

-- CreateIndex
CREATE INDEX "PayrollInputIssue_organizationId_periodId_status_idx" ON "PayrollInputIssue"("organizationId", "periodId", "status");

-- AddForeignKey
ALTER TABLE "PayrollCalendarSetting" ADD CONSTRAINT "PayrollCalendarSetting_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollCalendarEntry" ADD CONSTRAINT "PayrollCalendarEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollCalendarEntry" ADD CONSTRAINT "PayrollCalendarEntry_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "PayrollPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollInputItem" ADD CONSTRAINT "PayrollInputItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollInputItem" ADD CONSTRAINT "PayrollInputItem_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "PayrollPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollInputIssue" ADD CONSTRAINT "PayrollInputIssue_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollInputIssue" ADD CONSTRAINT "PayrollInputIssue_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "PayrollPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



ALTER TABLE "PayrollCalendarSetting" ADD CONSTRAINT "PayrollCalendarSetting_ranges" CHECK (
  "inputCutoffDay" BETWEEN 1 AND 28 AND "draftWorkingDays" BETWEEN 1 AND 15 AND "approvalWorkingDays" BETWEEN 1 AND 15
  AND "payDayOfMonth" BETWEEN 1 AND 31 AND "remittanceDueDay" BETWEEN 1 AND 31);
ALTER TABLE "PayrollCalendarEntry" ADD CONSTRAINT "PayrollCalendarEntry_order" CHECK ("inputCutoff" <= "draftDue" AND "draftDue" <= "approvalDue");
ALTER TABLE "PayrollCalendarEntry" ADD CONSTRAINT "PayrollCalendarEntry_adjustment_explained" CHECK (NOT "adjusted" OR length(btrim(coalesce("adjustReason", ''))) >= 10);
ALTER TABLE "PayrollInputItem" ADD CONSTRAINT "PayrollInputItem_received_recorded" CHECK ("status" <> 'RECEIVED' OR ("receivedAt" IS NOT NULL AND "markedBy" IS NOT NULL));
ALTER TABLE "PayrollInputIssue" ADD CONSTRAINT "PayrollInputIssue_resolved_explained" CHECK ("status" <> 'RESOLVED' OR ("resolvedAt" IS NOT NULL AND "resolvedBy" IS NOT NULL AND length(btrim(coalesce("resolution", ''))) >= 5));

-- The period an entry, item or issue points at must belong to the same organization.
CREATE OR REPLACE FUNCTION wfp_guard_calendar_org() RETURNS trigger AS $$
BEGIN
  IF current_setting('wfp.allow_ledger_reset', true) = 'on' THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM "PayrollPeriod" p WHERE p.id = NEW."periodId" AND p."organizationId" = NEW."organizationId") THEN
    RAISE EXCEPTION 'That payroll period belongs to a different organization.' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wfp_calendar_entry_org BEFORE INSERT ON "PayrollCalendarEntry" FOR EACH ROW EXECUTE FUNCTION wfp_guard_calendar_org();
CREATE TRIGGER wfp_input_item_org BEFORE INSERT ON "PayrollInputItem" FOR EACH ROW EXECUTE FUNCTION wfp_guard_calendar_org();
CREATE TRIGGER wfp_input_issue_org BEFORE INSERT ON "PayrollInputIssue" FOR EACH ROW EXECUTE FUNCTION wfp_guard_calendar_org();
