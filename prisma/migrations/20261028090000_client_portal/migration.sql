-- CreateEnum
CREATE TYPE "ClientDecision" AS ENUM ('APPROVED', 'REJECTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "Role" ADD VALUE 'CLIENT_APPROVER';
ALTER TYPE "Role" ADD VALUE 'CLIENT_HR';

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "clientApprovalRequired" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "PayrollClientApproval" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "calculationCount" INTEGER NOT NULL,
    "decision" "ClientDecision" NOT NULL,
    "comment" TEXT,
    "byName" TEXT NOT NULL,
    "byUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollClientApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PayrollClientApproval_organizationId_runId_createdAt_idx" ON "PayrollClientApproval"("organizationId", "runId", "createdAt");

-- AddForeignKey
ALTER TABLE "PayrollClientApproval" ADD CONSTRAINT "PayrollClientApproval_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



ALTER TABLE "PayrollClientApproval" ADD CONSTRAINT "PayrollClientApproval_refusal_explained" CHECK ("decision" <> 'REJECTED' OR length(btrim(coalesce("comment", ''))) >= 5);

-- The client's sign-off is a record of a decision. It is never changed or removed.
CREATE OR REPLACE FUNCTION wfp_protect_client_approvals() RETURNS trigger AS $$
BEGIN
  IF current_setting('wfp.allow_ledger_reset', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'A client approval cannot be changed or deleted.' USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wfp_client_approval_protected
  BEFORE UPDATE OR DELETE ON "PayrollClientApproval"
  FOR EACH ROW EXECUTE FUNCTION wfp_protect_client_approvals();

-- Where the organization requires the client's own approval, a regular payroll cannot be locked without one for the figures as they stand now.
CREATE OR REPLACE FUNCTION wfp_guard_client_approval_before_lock() RETURNS trigger AS $$
DECLARE required boolean; latest "ClientDecision"; latest_count int;
BEGIN
  IF current_setting('wfp.allow_ledger_reset', true) = 'on' THEN RETURN NEW; END IF;
  IF NEW.status = 'LOCKED' AND OLD.status IS DISTINCT FROM 'LOCKED' AND NEW.type = 'REGULAR' THEN
    SELECT "clientApprovalRequired" INTO required FROM "Organization" WHERE id = NEW."organizationId";
    IF required THEN
      SELECT decision, "calculationCount" INTO latest, latest_count FROM "PayrollClientApproval" WHERE "runId" = NEW.id ORDER BY "createdAt" DESC, id DESC LIMIT 1;
      IF latest IS DISTINCT FROM 'APPROVED' OR latest_count IS DISTINCT FROM NEW."calculationCount" THEN
        RAISE EXCEPTION 'This payroll needs the client''s approval of its current figures before it can be locked.' USING ERRCODE = 'restrict_violation';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wfp_payroll_client_approval_guard
  BEFORE UPDATE ON "PayrollRun"
  FOR EACH ROW EXECUTE FUNCTION wfp_guard_client_approval_before_lock();
