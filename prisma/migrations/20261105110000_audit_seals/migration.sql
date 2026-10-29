-- Tamper-evident audit log (rule 5): one seal per audit row, chained within an organization by a keyed hash.
-- A new table only: AuditLog and every existing row are untouched. To reverse, run down.sql in this folder (Prisma runs only migration.sql).

CREATE TABLE "AuditSeal" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "auditLogId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "prevHash" TEXT NOT NULL,
    "chainHash" TEXT NOT NULL,
    "sealedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sealedLate" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AuditSeal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AuditSeal_auditLogId_key" ON "AuditSeal"("auditLogId");
CREATE UNIQUE INDEX "AuditSeal_organizationId_seq_key" ON "AuditSeal"("organizationId", "seq");
CREATE INDEX "AuditSeal_organizationId_sealedAt_idx" ON "AuditSeal"("organizationId", "sealedAt");

ALTER TABLE "AuditSeal" ADD CONSTRAINT "AuditSeal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditSeal" ADD CONSTRAINT "AuditSeal_auditLogId_fkey" FOREIGN KEY ("auditLogId") REFERENCES "AuditLog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A seal can be added, never changed or removed, whoever is connected. Unlike the audit log itself there is NO redaction switch: a redacted audit row
-- keeps its seal, and the check accepts the new content only when an AUDIT_REDACTION entry declares it with a keyed proof.
-- (TRUNCATE is not intercepted by row triggers, so the seed script's full reset of a disposable database still works.)
CREATE OR REPLACE FUNCTION wfp_protect_audit_seal() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Audit seals are append-only: a seal cannot be deleted.' USING ERRCODE = 'restrict_violation';
  END IF;
  RAISE EXCEPTION 'Audit seals are append-only: a seal cannot be changed.' USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wfp_audit_seal_protected BEFORE UPDATE OR DELETE ON "AuditSeal"
  FOR EACH ROW EXECUTE FUNCTION wfp_protect_audit_seal();
