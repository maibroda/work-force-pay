-- Time entry erasure (docs/plans/hourly-payroll-followups-explain-back.md). Replaces ONE trigger function and adds nothing else: no table, no column, no data is touched.
--
-- Erasing a person must clear the words typed on their shifts: the reason for a correction and the note on a rejection. The protection built with time entries (20261226090000) refused every change to a decided entry,
-- so that clearing was impossible. This keeps every protection and adds exactly one allowed change, to an entry in ANY state: setting "reason" and/or "decisionNote" to NULL (never to other words) with NOTHING else
-- about the row changing (an update that changes nothing is also harmless and is allowed). Anything else, including blanking the words together with any other change, is refused as before. Deleting an entry is still refused.
CREATE OR REPLACE FUNCTION wfp_time_entry_protect() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A time entry is kept for the record and cannot be deleted; withdraw it, or correct it with a new entry.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (NEW."reason" IS NULL OR NEW."reason" IS NOT DISTINCT FROM OLD."reason")
     AND (NEW."decisionNote" IS NULL OR NEW."decisionNote" IS NOT DISTINCT FROM OLD."decisionNote")
     AND (to_jsonb(NEW) - 'reason' - 'decisionNote') = (to_jsonb(OLD) - 'reason' - 'decisionNote') THEN
    RETURN NEW;
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
