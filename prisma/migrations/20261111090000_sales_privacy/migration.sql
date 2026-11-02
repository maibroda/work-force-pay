-- Sales Phase 9a (docs/crm/09a-phase-9a-plan.md): the suppression list (keyed hashes, never addresses), data requests about a contact or lead, the lead-retention setting, and the marks left on an
-- erased contact or lead. Two new tables and nullable columns; nothing existing is changed.
-- It also gives FIVE existing guards one narrow exception: while a transaction has set the database flag app.crm_erasure (which lasts only until that transaction ends), erasing a person may blank
-- the PERSONAL columns of the protected rows (consent source and evidence; an activity's subject, body and survey; a case or handover history note; a handover site's contact details) and nothing else.
-- Every other change to those rows is still refused. To reverse, run down.sql in this folder (Prisma runs only migration.sql).

-- CreateEnum
CREATE TYPE "CrmSuppressionKind" AS ENUM ('EMAIL', 'PHONE');

-- CreateEnum
CREATE TYPE "CrmDataRequestKind" AS ENUM ('ACCESS', 'ERASURE', 'RETENTION');

-- CreateEnum
CREATE TYPE "CrmDataRequestStatus" AS ENUM ('OPEN', 'COMPLETED', 'REFUSED');

-- AlterTable
ALTER TABLE "CrmContact" ADD COLUMN     "erasedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "CrmLead" ADD COLUMN     "erasedAt" TIMESTAMP(3),
ADD COLUMN     "retentionKeepUntil" DATE;

-- AlterTable
ALTER TABLE "CrmSetting" ADD COLUMN     "leadRetentionMonths" INTEGER;

-- CreateTable
CREATE TABLE "CrmSuppression" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" "CrmSuppressionKind" NOT NULL,
    "valueHash" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "CrmSuppression_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmDataRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "kind" "CrmDataRequestKind" NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "requesterName" TEXT,
    "channel" TEXT,
    "receivedOn" DATE NOT NULL,
    "dueOn" DATE NOT NULL,
    "status" "CrmDataRequestStatus" NOT NULL DEFAULT 'OPEN',
    "identityVerified" BOOLEAN NOT NULL DEFAULT false,
    "identityNote" TEXT,
    "verifiedBy" TEXT,
    "exportedAt" TIMESTAMP(3),
    "exportChecksum" TEXT,
    "exportSections" JSONB,
    "reviewList" JSONB,
    "handledBy" TEXT,
    "completedOn" TIMESTAMP(3),
    "outcomeNote" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "CrmDataRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CrmSuppression_organizationId_kind_valueHash_key" ON "CrmSuppression"("organizationId", "kind", "valueHash");

-- CreateIndex
CREATE INDEX "CrmDataRequest_organizationId_status_idx" ON "CrmDataRequest"("organizationId", "status");

-- CreateIndex
CREATE INDEX "CrmDataRequest_organizationId_subjectType_subjectId_idx" ON "CrmDataRequest"("organizationId", "subjectType", "subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmDataRequest_organizationId_number_key" ON "CrmDataRequest"("organizationId", "number");

-- AddForeignKey
ALTER TABLE "CrmSuppression" ADD CONSTRAINT "CrmSuppression_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmDataRequest" ADD CONSTRAINT "CrmDataRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION crm_consent_immutable() RETURNS trigger AS $$
BEGIN
  -- the one exception: erasing a person on a data request may blank where the consent came from and its evidence, nothing else
  IF TG_OP = 'UPDATE' AND current_setting('app.crm_erasure', true) = 'on' AND (to_jsonb(NEW) - 'source' - 'evidenceRef') = (to_jsonb(OLD) - 'source' - 'evidenceRef') THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'A consent record cannot be changed or deleted. Record a new one instead.' USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION crm_activity_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'An activity cannot be deleted. Void it with a reason instead.' USING ERRCODE = 'restrict_violation';
  END IF;
  -- the one exception: erasing a person on a data request may blank what an activity says, nothing else
  IF current_setting('app.crm_erasure', true) = 'on' AND (to_jsonb(NEW) - 'subject' - 'body' - 'survey') = (to_jsonb(OLD) - 'subject' - 'body' - 'survey') THEN RETURN NEW; END IF;
  IF OLD."voidedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'A voided activity cannot be changed.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (to_jsonb(NEW) - 'voidedAt' - 'voidedBy' - 'voidReason') IS DISTINCT FROM (to_jsonb(OLD) - 'voidedAt' - 'voidedBy' - 'voidReason') THEN
    RAISE EXCEPTION 'What an activity says cannot be changed. Void it with a reason and log a new one.' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION crm_case_event_immutable() RETURNS trigger AS $$
BEGIN
  -- the one exception: erasing a person on a data request may blank a note, nothing else
  IF TG_OP = 'UPDATE' AND current_setting('app.crm_erasure', true) = 'on' AND (to_jsonb(NEW) - 'note') = (to_jsonb(OLD) - 'note') THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'A case history record cannot be changed or deleted.' USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION crm_handover_event_immutable() RETURNS trigger AS $$
BEGIN
  -- the one exception: erasing a person on a data request may blank a note, nothing else
  IF TG_OP = 'UPDATE' AND current_setting('app.crm_erasure', true) = 'on' AND (to_jsonb(NEW) - 'note') = (to_jsonb(OLD) - 'note') THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'A handover history record cannot be changed or deleted.' USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION crm_handover_child_guard() RETURNS trigger AS $$
DECLARE
  hid TEXT;
  st TEXT;
  o JSONB;
  n JSONB;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A site or post of a handover cannot be deleted.' USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT "status"::text INTO st FROM "CrmHandover" WHERE "id" = NEW."handoverId";
  IF TG_OP = 'INSERT' THEN
    IF st IS NOT NULL AND st <> 'DRAFT' THEN
      RAISE EXCEPTION 'Sites and posts cannot be added to a handover that has been sent.' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  o := to_jsonb(OLD);
  n := to_jsonb(NEW);
  -- the one exception: erasing a person on a data request may blank the client's site contact (name, role, phone, email) on any site, nothing else
  IF TG_TABLE_NAME = 'CrmHandoverSite' AND current_setting('app.crm_erasure', true) = 'on' AND (n - 'contactName' - 'contactRole' - 'contactPhoneE164' - 'contactEmail') = (o - 'contactName' - 'contactRole' - 'contactPhoneE164' - 'contactEmail') THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'CrmHandoverSite' THEN
    IF (n - 'beatId') = (o - 'beatId') AND OLD."beatId" IS NULL THEN RETURN NEW; END IF;
    IF st NOT IN ('DRAFT', 'RETURNED') THEN
      RAISE EXCEPTION 'A site of a handover that has been sent cannot be changed.' USING ERRCODE = 'restrict_violation';
    END IF;
    IF (n - 'address' - 'state' - 'lga' - 'contactName' - 'contactRole' - 'contactPhoneE164' - 'contactEmail' - 'equipment' - 'noEquipment') IS DISTINCT FROM
       (o - 'address' - 'state' - 'lga' - 'contactName' - 'contactRole' - 'contactPhoneE164' - 'contactEmail' - 'equipment' - 'noEquipment') THEN
      RAISE EXCEPTION 'The name and order of a handover site come from the quote and cannot be changed.' USING ERRCODE = 'restrict_violation';
    END IF;
  ELSE
    IF st NOT IN ('DRAFT', 'RETURNED') THEN
      RAISE EXCEPTION 'A post of a handover that has been sent cannot be changed.' USING ERRCODE = 'restrict_violation';
    END IF;
    IF (n - 'categoryId') IS DISTINCT FROM (o - 'categoryId') THEN
      RAISE EXCEPTION 'The guards, shifts and bill rates of a handover come from the quote and cannot be changed.' USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
