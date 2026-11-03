-- Reverses migration.sql: the five guards go back exactly as they were, and the suppression list, the data requests and the new columns are lost.
CREATE OR REPLACE FUNCTION crm_consent_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'A consent record cannot be changed or deleted. Record a new one instead.' USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION crm_activity_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'An activity cannot be deleted. Void it with a reason instead.' USING ERRCODE = 'restrict_violation';
  END IF;
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
  RAISE EXCEPTION 'A case history record cannot be changed or deleted.' USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION crm_handover_event_immutable() RETURNS trigger AS $$
BEGIN
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

DROP TABLE "CrmDataRequest";
DROP TABLE "CrmSuppression";
ALTER TABLE "CrmSetting" DROP COLUMN "leadRetentionMonths";
ALTER TABLE "CrmLead" DROP COLUMN "erasedAt", DROP COLUMN "retentionKeepUntil";
ALTER TABLE "CrmContact" DROP COLUMN "erasedAt";
DROP TYPE "CrmDataRequestStatus";
DROP TYPE "CrmDataRequestKind";
DROP TYPE "CrmSuppressionKind";
