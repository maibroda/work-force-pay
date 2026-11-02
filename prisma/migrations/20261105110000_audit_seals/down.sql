-- Reverses migration.sql. The seals are lost (they can be rebuilt by the sealing job, marked "sealed late"); the audit log itself is untouched.
-- Dropping the table drops its trigger; the function is dropped after it.
DROP TABLE "AuditSeal";
DROP FUNCTION wfp_protect_audit_seal();
