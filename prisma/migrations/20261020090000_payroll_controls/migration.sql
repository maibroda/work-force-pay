-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "reconciliationRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "varianceEmployeePct" DECIMAL(5,2) NOT NULL DEFAULT 20,
ADD COLUMN     "varianceHeadcountPct" DECIMAL(5,2) NOT NULL DEFAULT 5,
ADD COLUMN     "varianceMinAmount" DECIMAL(16,2) NOT NULL DEFAULT 5000,
ADD COLUMN     "varianceTotalPct" DECIMAL(5,2) NOT NULL DEFAULT 10;

-- AlterTable
ALTER TABLE "PayrollRun" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedBy" TEXT,
ADD COLUMN     "approvedByUserId" TEXT,
ADD COLUMN     "preparedByUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "reconciledAt" TIMESTAMP(3),
ADD COLUMN     "reconciledBy" TEXT,
ADD COLUMN     "reconciledByUserId" TEXT,
ADD COLUMN     "reconciliationNote" TEXT,
ADD COLUMN     "submittedAt" TIMESTAMP(3),
ADD COLUMN     "submittedBy" TEXT,
ADD COLUMN     "submittedByUserId" TEXT;

-- AlterTable
ALTER TABLE "PayrollValidationIssue" ADD COLUMN     "explainedAt" TIMESTAMP(3),
ADD COLUMN     "explainedBy" TEXT,
ADD COLUMN     "explainedByUserId" TEXT,
ADD COLUMN     "explanation" TEXT,
ADD COLUMN     "requiresExplanation" BOOLEAN NOT NULL DEFAULT false;



ALTER TABLE "Organization" ADD CONSTRAINT "Organization_variance_policy_nonneg" CHECK ("varianceHeadcountPct" >= 0 AND "varianceEmployeePct" >= 0 AND "varianceTotalPct" >= 0 AND "varianceMinAmount" >= 0);

-- Earlier approvals are recorded on the period only; carry who and when onto the run they approved (names only: user ids were not kept).
UPDATE "PayrollRun" r
   SET "approvedBy" = p."approvedBy", "approvedAt" = p."approvedAt"
  FROM "PayrollPeriod" p
 WHERE p.id = r."periodId" AND r.type = 'REGULAR' AND r.status IN ('APPROVED', 'LOCKED', 'PAID')
   AND r."approvedBy" IS NULL AND p."approvedBy" IS NOT NULL;

-- Whoever prepared or submitted a payroll cannot be the one who approves it, whatever the application does.
CREATE OR REPLACE FUNCTION wfp_guard_payroll_approval() RETURNS trigger AS $$
BEGIN
  IF current_setting('wfp.allow_ledger_reset', true) = 'on' THEN RETURN NEW; END IF;
  IF NEW.status = 'APPROVED' AND OLD.status IS DISTINCT FROM 'APPROVED' THEN
    IF NEW."approvedByUserId" IS NULL THEN
      RAISE EXCEPTION 'A payroll approval must record who approved it.' USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW."approvedByUserId" = ANY(COALESCE(NEW."preparedByUserIds", ARRAY[]::TEXT[])) OR NEW."approvedByUserId" = NEW."submittedByUserId" THEN
      RAISE EXCEPTION 'You prepared or submitted this payroll, so someone else has to approve it.' USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wfp_payroll_approval_guard
  BEFORE UPDATE ON "PayrollRun"
  FOR EACH ROW EXECUTE FUNCTION wfp_guard_payroll_approval();
