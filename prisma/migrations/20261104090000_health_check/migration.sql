-- CreateEnum
CREATE TYPE "HealthCheckStatus" AS ENUM ('IN_PROGRESS', 'IN_REVIEW', 'ISSUED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ControlResponse" AS ENUM ('NOT_ASSESSED', 'IN_PLACE', 'PARTLY', 'NOT_SEEN', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "FindingSeverity" AS ENUM ('HIGH', 'MEDIUM', 'LOW', 'OBSERVATION');

-- CreateTable
CREATE TABLE "HealthCheck" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "scopeNote" TEXT,
    "periodReviewed" TEXT,
    "employeesInScope" INTEGER,
    "feeQuoted" DECIMAL(14,2),
    "templateVersion" TEXT NOT NULL,
    "status" "HealthCheckStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "assessedBy" TEXT NOT NULL,
    "assessedByUserId" TEXT NOT NULL,
    "conductedOn" DATE,
    "submittedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "headline" TEXT,
    "issuedAt" TIMESTAMP(3),
    "withdrawnReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HealthCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HealthCheckItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "checkId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "question" TEXT NOT NULL,
    "guidance" TEXT NOT NULL,
    "response" "ControlResponse" NOT NULL DEFAULT 'NOT_ASSESSED',
    "evidence" TEXT,
    "note" TEXT,
    "assessedAt" TIMESTAMP(3),

    CONSTRAINT "HealthCheckItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HealthCheckFinding" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "checkId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "itemCode" TEXT,
    "area" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" "FindingSeverity" NOT NULL,
    "recommendation" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HealthCheckFinding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HealthCheck_leadId_idx" ON "HealthCheck"("leadId");

-- CreateIndex
CREATE INDEX "HealthCheck_organizationId_status_idx" ON "HealthCheck"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "HealthCheck_organizationId_number_key" ON "HealthCheck"("organizationId", "number");

-- CreateIndex
CREATE INDEX "HealthCheckItem_checkId_idx" ON "HealthCheckItem"("checkId");

-- CreateIndex
CREATE UNIQUE INDEX "HealthCheckItem_checkId_code_key" ON "HealthCheckItem"("checkId", "code");

-- CreateIndex
CREATE INDEX "HealthCheckFinding_checkId_idx" ON "HealthCheckFinding"("checkId");

-- CreateIndex
CREATE UNIQUE INDEX "HealthCheckFinding_checkId_number_key" ON "HealthCheckFinding"("checkId", "number");

-- AddForeignKey
ALTER TABLE "HealthCheck" ADD CONSTRAINT "HealthCheck_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthCheck" ADD CONSTRAINT "HealthCheck_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthCheckItem" ADD CONSTRAINT "HealthCheckItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthCheckItem" ADD CONSTRAINT "HealthCheckItem_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "HealthCheck"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthCheckFinding" ADD CONSTRAINT "HealthCheckFinding_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthCheckFinding" ADD CONSTRAINT "HealthCheckFinding_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "HealthCheck"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- The rules of a health check, held by the database: a control rated in place or partly has evidence behind it, a gap is never left
-- unreported, a second person (never the assessor) issues it, and once issued (or withdrawn) it can't change. The checklist copied onto a check
-- is never edited, only answered.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE "HealthCheck" ADD CONSTRAINT "HealthCheck_ranges" CHECK (("employeesInScope" IS NULL OR "employeesInScope" > 0) AND ("feeQuoted" IS NULL OR "feeQuoted" >= 0));
ALTER TABLE "HealthCheck" ADD CONSTRAINT "HealthCheck_review_needs_submission" CHECK ("status" <> 'IN_REVIEW' OR "submittedAt" IS NOT NULL);
ALTER TABLE "HealthCheck" ADD CONSTRAINT "HealthCheck_issued_by_another_person" CHECK ("status" <> 'ISSUED' OR ("reviewedByUserId" IS NOT NULL AND "reviewedAt" IS NOT NULL AND "issuedAt" IS NOT NULL AND "reviewedByUserId" <> "assessedByUserId"));
ALTER TABLE "HealthCheck" ADD CONSTRAINT "HealthCheck_withdrawn_says_why" CHECK ("status" <> 'WITHDRAWN' OR length(btrim(coalesce("withdrawnReason", ''))) >= 5);
ALTER TABLE "HealthCheckItem" ADD CONSTRAINT "HealthCheckItem_evidence_behind_response" CHECK ("response" NOT IN ('IN_PLACE', 'PARTLY') OR length(btrim(coalesce("evidence", ''))) >= 10);
ALTER TABLE "HealthCheckItem" ADD CONSTRAINT "HealthCheckItem_not_seen_says_what" CHECK ("response" <> 'NOT_SEEN' OR length(btrim(coalesce("evidence", ''))) >= 5 OR length(btrim(coalesce("note", ''))) >= 5);
ALTER TABLE "HealthCheckItem" ADD CONSTRAINT "HealthCheckItem_not_applicable_says_why" CHECK ("response" <> 'NOT_APPLICABLE' OR length(btrim(coalesce("note", ''))) >= 5);
ALTER TABLE "HealthCheckFinding" ADD CONSTRAINT "HealthCheckFinding_says_something" CHECK (length(btrim("title")) >= 5 AND length(btrim("description")) >= 10 AND length(btrim("recommendation")) >= 10);

CREATE OR REPLACE FUNCTION wfp_health_check_guard() RETURNS trigger AS $$
DECLARE unassessed int; ungapped int;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A health check is never deleted; withdraw it instead.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."status" IN ('ISSUED', 'WITHDRAWN') THEN
    RAISE EXCEPTION 'This health check has been issued or withdrawn and cannot change.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" THEN
    IF OLD."status" = 'IN_PROGRESS' AND NEW."status" = 'ISSUED' THEN
      RAISE EXCEPTION 'A health check is reviewed before it is issued.' USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW."status" IN ('IN_REVIEW', 'ISSUED') THEN
      SELECT count(*) INTO unassessed FROM "HealthCheckItem" WHERE "checkId" = NEW."id" AND "response" = 'NOT_ASSESSED';
      IF unassessed > 0 THEN
        RAISE EXCEPTION '% control(s) have not been assessed yet.', unassessed USING ERRCODE = 'restrict_violation';
      END IF;
      SELECT count(*) INTO ungapped FROM "HealthCheckItem" i
        WHERE i."checkId" = NEW."id" AND i."response" IN ('PARTLY', 'NOT_SEEN')
          AND NOT EXISTS (SELECT 1 FROM "HealthCheckFinding" f WHERE f."checkId" = NEW."id" AND f."itemCode" = i."code");
      IF ungapped > 0 THEN
        RAISE EXCEPTION '% gap(s) have no finding recorded against them.', ungapped USING ERRCODE = 'restrict_violation';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wfp_health_check_guard BEFORE UPDATE OR DELETE ON "HealthCheck" FOR EACH ROW EXECUTE FUNCTION wfp_health_check_guard();

CREATE OR REPLACE FUNCTION wfp_health_check_child_guard() RETURNS trigger AS $$
DECLARE s text; cid text;
BEGIN
  cid := CASE WHEN TG_OP = 'DELETE' THEN OLD."checkId" ELSE NEW."checkId" END;
  SELECT "status" INTO s FROM "HealthCheck" WHERE "id" = cid;
  IF s IS DISTINCT FROM 'IN_PROGRESS' THEN
    RAISE EXCEPTION 'A health check can only be changed while it is in progress.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_TABLE_NAME = 'HealthCheckItem' THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'A checklist item cannot be removed.' USING ERRCODE = 'restrict_violation';
    END IF;
    IF TG_OP = 'UPDATE' AND (NEW."code" IS DISTINCT FROM OLD."code" OR NEW."area" IS DISTINCT FROM OLD."area" OR NEW."position" IS DISTINCT FROM OLD."position"
       OR NEW."question" IS DISTINCT FROM OLD."question" OR NEW."guidance" IS DISTINCT FROM OLD."guidance" OR NEW."checkId" IS DISTINCT FROM OLD."checkId") THEN
      RAISE EXCEPTION 'The checklist is answered, never edited.' USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wfp_health_check_item_guard BEFORE INSERT OR UPDATE OR DELETE ON "HealthCheckItem" FOR EACH ROW EXECUTE FUNCTION wfp_health_check_child_guard();
CREATE TRIGGER wfp_health_check_finding_guard BEFORE INSERT OR UPDATE OR DELETE ON "HealthCheckFinding" FOR EACH ROW EXECUTE FUNCTION wfp_health_check_child_guard();
