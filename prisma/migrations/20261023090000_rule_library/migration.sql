-- CreateEnum
CREATE TYPE "RuleKind" AS ENUM ('TAX', 'PENSION', 'EMPLOYER_COST');

-- CreateEnum
CREATE TYPE "RuleReleaseStatus" AS ENUM ('PROPOSED', 'VERIFIED', 'PUBLISHED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "VerifierSlot" AS ENUM ('HR', 'FINANCE');

-- CreateEnum
CREATE TYPE "RulePublicationOutcome" AS ENUM ('PUBLISHED', 'ALREADY_HELD', 'FAILED');

-- CreateTable
CREATE TABLE "RuleRelease" (
    "id" TEXT NOT NULL,
    "bureauOrganizationId" TEXT NOT NULL,
    "kind" "RuleKind" NOT NULL,
    "ruleId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "summary" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "status" "RuleReleaseStatus" NOT NULL DEFAULT 'PROPOSED',
    "proposedBy" TEXT NOT NULL,
    "proposedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "publishedBy" TEXT,
    "withdrawnReason" TEXT,
    "withdrawnBy" TEXT,

    CONSTRAINT "RuleRelease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleVerification" (
    "id" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "slot" "VerifierSlot" NOT NULL,
    "verifierName" TEXT NOT NULL,
    "verifierUserId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RuleVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RulePublication" (
    "id" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "clientOrganizationId" TEXT NOT NULL,
    "outcome" "RulePublicationOutcome" NOT NULL,
    "message" TEXT,
    "publishedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RulePublication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RuleRelease_bureauOrganizationId_createdAt_idx" ON "RuleRelease"("bureauOrganizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RuleVerification_releaseId_slot_key" ON "RuleVerification"("releaseId", "slot");

-- CreateIndex
CREATE UNIQUE INDEX "RulePublication_releaseId_clientOrganizationId_key" ON "RulePublication"("releaseId", "clientOrganizationId");

-- AddForeignKey
ALTER TABLE "RuleRelease" ADD CONSTRAINT "RuleRelease_bureauOrganizationId_fkey" FOREIGN KEY ("bureauOrganizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleVerification" ADD CONSTRAINT "RuleVerification_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "RuleRelease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RulePublication" ADD CONSTRAINT "RulePublication_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "RuleRelease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RulePublication" ADD CONSTRAINT "RulePublication_clientOrganizationId_fkey" FOREIGN KEY ("clientOrganizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



ALTER TABLE "RuleRelease" ADD CONSTRAINT "RuleRelease_text_present" CHECK (length(btrim("summary")) >= 10 AND length(btrim("source")) >= 5);

-- A release's identity never changes, it moves forward only (proposed -> verified -> published, or withdrawn), and it is never deleted.
CREATE OR REPLACE FUNCTION wfp_guard_rule_release() RETURNS trigger AS $$
DECLARE n int;
BEGIN
  IF current_setting('wfp.allow_ledger_reset', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A rule release cannot be deleted. Withdraw it instead.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."bureauOrganizationId" IS DISTINCT FROM OLD."bureauOrganizationId" OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW."ruleId" IS DISTINCT FROM OLD."ruleId"
     OR NEW.version IS DISTINCT FROM OLD.version OR NEW."effectiveFrom" IS DISTINCT FROM OLD."effectiveFrom" OR NEW.checksum IS DISTINCT FROM OLD.checksum
     OR NEW."proposedByUserId" IS DISTINCT FROM OLD."proposedByUserId" OR NEW.summary IS DISTINCT FROM OLD.summary OR NEW.source IS DISTINCT FROM OLD.source THEN
    RAISE EXCEPTION 'What a rule release covers cannot be changed. Withdraw it and propose a new one.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status IN ('PUBLISHED', 'WITHDRAWN') THEN
      RAISE EXCEPTION 'A published or withdrawn rule release cannot change status.' USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status = 'VERIFIED' THEN
      SELECT count(DISTINCT slot) INTO n FROM "RuleVerification" WHERE "releaseId" = NEW.id;
      IF n < 2 THEN
        RAISE EXCEPTION 'A rule release needs both an HR and a Finance verification.' USING ERRCODE = 'restrict_violation';
      END IF;
    ELSIF NEW.status = 'PUBLISHED' THEN
      IF OLD.status <> 'VERIFIED' OR NEW."publishedAt" IS NULL THEN
        RAISE EXCEPTION 'Only a verified rule release can be published.' USING ERRCODE = 'restrict_violation';
      END IF;
    ELSIF NEW.status = 'PROPOSED' THEN
      RAISE EXCEPTION 'A rule release cannot go back to proposed.' USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wfp_rule_release_guard
  BEFORE UPDATE OR DELETE ON "RuleRelease"
  FOR EACH ROW EXECUTE FUNCTION wfp_guard_rule_release();

-- A verification is by someone other than the proposer, in the HR or Finance role its slot names, of exactly what was proposed. It is never changed.
CREATE OR REPLACE FUNCTION wfp_guard_rule_verification() RETURNS trigger AS $$
DECLARE rel "RuleRelease"%ROWTYPE; r "Role";
BEGIN
  IF current_setting('wfp.allow_ledger_reset', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'A rule verification cannot be changed or deleted.' USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT * INTO rel FROM "RuleRelease" WHERE id = NEW."releaseId";
  IF rel.status <> 'PROPOSED' THEN
    RAISE EXCEPTION 'Only a proposed rule release can be verified.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."verifierUserId" = rel."proposedByUserId" THEN
    RAISE EXCEPTION 'You proposed this rule, so someone else has to verify it.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.checksum <> rel.checksum THEN
    RAISE EXCEPTION 'The rule changed after it was proposed; it has to be proposed again.' USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT role INTO r FROM "User" WHERE id = NEW."verifierUserId";
  IF (NEW.slot = 'HR' AND r IS DISTINCT FROM 'HR_ADMIN') OR (NEW.slot = 'FINANCE' AND r IS DISTINCT FROM 'FINANCE') THEN
    RAISE EXCEPTION 'The % verification has to come from someone in that role.', NEW.slot USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wfp_rule_verification_guard
  BEFORE INSERT OR UPDATE OR DELETE ON "RuleVerification"
  FOR EACH ROW EXECUTE FUNCTION wfp_guard_rule_verification();

-- A publication is recorded only for a published release and one of the same bureau's clients. It is never changed.
CREATE OR REPLACE FUNCTION wfp_guard_rule_publication() RETURNS trigger AS $$
DECLARE rel "RuleRelease"%ROWTYPE;
BEGIN
  IF current_setting('wfp.allow_ledger_reset', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'A rule publication record cannot be changed or deleted.' USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT * INTO rel FROM "RuleRelease" WHERE id = NEW."releaseId";
  IF rel.status <> 'PUBLISHED' THEN
    RAISE EXCEPTION 'Only a verified and published rule release can be sent to clients.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "Organization" c WHERE c.id = NEW."clientOrganizationId" AND c."bureauOrganizationId" = rel."bureauOrganizationId") THEN
    RAISE EXCEPTION 'That organization is not a client of this bureau.' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wfp_rule_publication_guard
  BEFORE INSERT OR UPDATE OR DELETE ON "RulePublication"
  FOR EACH ROW EXECUTE FUNCTION wfp_guard_rule_publication();
