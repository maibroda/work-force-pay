-- Reverses 20261227090000_time_entry_erasure: puts back the protection function exactly as 20261226090000_time_entries made it, which allows no change to a decided time entry at all (so the words on a
-- person's shifts can no longer be cleared on erasure, and an erasure would fail while any such entry has words). No table, column or data is touched.
CREATE OR REPLACE FUNCTION wfp_time_entry_protect() RETURNS trigger AS $$
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
