-- CreateEnum
CREATE TYPE "EngagementPackage" AS ENUM ('PAYROLL_ESSENTIALS', 'PAYROLL_COMPLIANCE', 'MANAGED_PAYROLL_PLUS', 'ENTERPRISE', 'HEALTH_CHECK');

-- CreateEnum
CREATE TYPE "EngagementStatus" AS ENUM ('ONBOARDING', 'ACTIVE', 'PAUSED', 'ENDED');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "bureauOrganizationId" TEXT,
ADD COLUMN     "isBureau" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ClientEngagement" (
    "id" TEXT NOT NULL,
    "bureauOrganizationId" TEXT NOT NULL,
    "clientOrganizationId" TEXT NOT NULL,
    "package" "EngagementPackage" NOT NULL,
    "status" "EngagementStatus" NOT NULL DEFAULT 'ONBOARDING',
    "startDate" DATE NOT NULL,
    "termMonths" INTEGER NOT NULL,
    "perEmployeeRate" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "monthlyMinimum" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "onboardingFee" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "addOns" TEXT,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "slaTerms" TEXT,
    "dpaReference" TEXT,
    "dpaSignedAt" DATE,
    "notes" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientEngagement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffClientAccess" (
    "id" TEXT NOT NULL,
    "bureauOrganizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientOrganizationId" TEXT NOT NULL,
    "grantedBy" TEXT NOT NULL,
    "grantedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffClientAccess_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClientEngagement_clientOrganizationId_key" ON "ClientEngagement"("clientOrganizationId");

-- CreateIndex
CREATE INDEX "ClientEngagement_bureauOrganizationId_status_idx" ON "ClientEngagement"("bureauOrganizationId", "status");

-- CreateIndex
CREATE INDEX "StaffClientAccess_clientOrganizationId_idx" ON "StaffClientAccess"("clientOrganizationId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffClientAccess_userId_clientOrganizationId_key" ON "StaffClientAccess"("userId", "clientOrganizationId");

-- AddForeignKey
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_bureauOrganizationId_fkey" FOREIGN KEY ("bureauOrganizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientEngagement" ADD CONSTRAINT "ClientEngagement_bureauOrganizationId_fkey" FOREIGN KEY ("bureauOrganizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientEngagement" ADD CONSTRAINT "ClientEngagement_clientOrganizationId_fkey" FOREIGN KEY ("clientOrganizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffClientAccess" ADD CONSTRAINT "StaffClientAccess_bureauOrganizationId_fkey" FOREIGN KEY ("bureauOrganizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffClientAccess" ADD CONSTRAINT "StaffClientAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffClientAccess" ADD CONSTRAINT "StaffClientAccess_clientOrganizationId_fkey" FOREIGN KEY ("clientOrganizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



ALTER TABLE "ClientEngagement" ADD CONSTRAINT "ClientEngagement_term_months" CHECK ("termMonths" IN (6, 12));
ALTER TABLE "ClientEngagement" ADD CONSTRAINT "ClientEngagement_fees_nonneg" CHECK ("perEmployeeRate" >= 0 AND "monthlyMinimum" >= 0 AND "onboardingFee" >= 0);

-- A client organization belongs to exactly one bureau, which must be a bureau and cannot itself be a client. Once set, the link is permanent:
-- re-parenting a client would hand its payroll data to another bureau.
CREATE OR REPLACE FUNCTION wfp_guard_bureau_link() RETURNS trigger AS $$
BEGIN
  IF current_setting('wfp.allow_ledger_reset', true) = 'on' THEN RETURN NEW; END IF;
  IF NEW."bureauOrganizationId" IS NOT NULL THEN
    IF NEW."isBureau" THEN
      RAISE EXCEPTION 'A bureau cannot itself be a client of another bureau.' USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW."bureauOrganizationId" = NEW.id THEN
      RAISE EXCEPTION 'An organization cannot be its own bureau.' USING ERRCODE = 'restrict_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM "Organization" b WHERE b.id = NEW."bureauOrganizationId" AND b."isBureau") THEN
      RAISE EXCEPTION 'The bureau of a client must be an organization marked as a bureau.' USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD."bureauOrganizationId" IS NOT NULL AND NEW."bureauOrganizationId" IS DISTINCT FROM OLD."bureauOrganizationId" THEN
      RAISE EXCEPTION 'A client cannot be moved to another bureau.' USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD."isBureau" AND NOT NEW."isBureau" AND EXISTS (SELECT 1 FROM "Organization" c WHERE c."bureauOrganizationId" = NEW.id) THEN
      RAISE EXCEPTION 'A bureau with clients cannot stop being a bureau.' USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wfp_bureau_link_guard
  BEFORE INSERT OR UPDATE ON "Organization"
  FOR EACH ROW EXECUTE FUNCTION wfp_guard_bureau_link();

-- Staff access is only ever between a bureau's own users and that bureau's own clients; so is an engagement.
CREATE OR REPLACE FUNCTION wfp_guard_staff_access() RETURNS trigger AS $$
BEGIN
  IF current_setting('wfp.allow_ledger_reset', true) = 'on' THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM "User" u WHERE u.id = NEW."userId" AND u."organizationId" = NEW."bureauOrganizationId") THEN
    RAISE EXCEPTION 'Only a bureau''s own staff can be given access to its clients.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "Organization" c WHERE c.id = NEW."clientOrganizationId" AND c."bureauOrganizationId" = NEW."bureauOrganizationId") THEN
    RAISE EXCEPTION 'That organization is not a client of this bureau.' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wfp_staff_access_guard
  BEFORE INSERT ON "StaffClientAccess"
  FOR EACH ROW EXECUTE FUNCTION wfp_guard_staff_access();

CREATE OR REPLACE FUNCTION wfp_guard_engagement() RETURNS trigger AS $$
BEGIN
  IF current_setting('wfp.allow_ledger_reset', true) = 'on' THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM "Organization" c WHERE c.id = NEW."clientOrganizationId" AND c."bureauOrganizationId" = NEW."bureauOrganizationId") THEN
    RAISE EXCEPTION 'That organization is not a client of this bureau.' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wfp_engagement_guard
  BEFORE INSERT ON "ClientEngagement"
  FOR EACH ROW EXECUTE FUNCTION wfp_guard_engagement();
