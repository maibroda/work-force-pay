-- The audit log is append-only: a row can be added, never changed or removed, whoever is connected to the database.
--
-- A deliberate redaction (for example masking a person's identifiers after an erasure request, or in the field-encryption rollout) sets
--   SET LOCAL wfp.allow_audit_redaction = 'on'
-- inside its own transaction, which is itself a decision to be recorded. TRUNCATE is not intercepted by row triggers, so the seed script's full
-- reset of a disposable database still works.
CREATE OR REPLACE FUNCTION wfp_protect_audit_log() RETURNS trigger AS $$
BEGIN
  IF current_setting('wfp.allow_audit_redaction', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'The audit log is append-only: an entry cannot be deleted.' USING ERRCODE = 'restrict_violation';
  END IF;
  RAISE EXCEPTION 'The audit log is append-only: an entry cannot be changed.' USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wfp_audit_log_protected BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION wfp_protect_audit_log();
