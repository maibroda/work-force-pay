-- Sales Phase 7a (docs/crm/07a-phase-7a-plan.md): cases and their history, SLA policies, business hours and holidays, the renewal deals opened for contracts, and the renewal window setting.
-- New tables and one defaulted column on CrmSetting. The database refuses to change or delete a case event, and allows one renewal deal for each contract.
-- To reverse, run down.sql in this folder (Prisma runs only migration.sql).

-- CreateEnum
CREATE TYPE "CrmCasePriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "CrmCaseCategory" AS ENUM ('SERVICE_QUALITY', 'STAFFING', 'BILLING', 'COMPLAINT', 'REQUEST', 'OTHER');

-- CreateEnum
CREATE TYPE "CrmCaseStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateEnum
CREATE TYPE "CrmCaseEventKind" AS ENUM ('OPENED', 'RESPONDED', 'NOTE', 'REASSIGNED', 'RESOLVED', 'REOPENED', 'WARNING', 'BREACH', 'ESCALATED');

-- AlterTable
ALTER TABLE "CrmSetting" ADD COLUMN     "renewalWindowDays" INTEGER NOT NULL DEFAULT 90;

-- CreateTable
CREATE TABLE "CrmSlaPolicy" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "accountId" TEXT,
    "accountKey" TEXT NOT NULL DEFAULT '',
    "priority" "CrmCasePriority" NOT NULL,
    "firstResponseMinutes" INTEGER NOT NULL,
    "resolutionMinutes" INTEGER NOT NULL,
    "businessHoursOnly" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

CONSTRAINT "CrmSlaPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmBusinessHours" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "openMinute" INTEGER NOT NULL DEFAULT 480,
    "closeMinute" INTEGER NOT NULL DEFAULT 1020,
    "workDays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    "updatedBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

CONSTRAINT "CrmBusinessHours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmHoliday" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "CrmHoliday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmCase" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "contactId" TEXT,
    "opportunityId" TEXT,
    "beatId" TEXT,
    "category" "CrmCaseCategory" NOT NULL,
    "priority" "CrmCasePriority" NOT NULL,
    "status" "CrmCaseStatus" NOT NULL DEFAULT 'OPEN',
    "subject" TEXT NOT NULL,
    "description" TEXT,
    "ownerUserId" TEXT NOT NULL,
    "ownerName" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "slaPolicyId" TEXT,
    "slaFirstResponseMinutes" INTEGER,
    "slaResolutionMinutes" INTEGER,
    "slaBusinessHoursOnly" BOOLEAN NOT NULL DEFAULT false,
    "firstResponseDueAt" TIMESTAMP(3),
    "firstResponseWarnAt" TIMESTAMP(3),
    "firstRespondedAt" TIMESTAMP(3),
    "firstResponseWarnedAt" TIMESTAMP(3),
    "firstResponseBreachedAt" TIMESTAMP(3),
    "resolutionStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolutionDueAt" TIMESTAMP(3),
    "resolutionWarnAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolutionWarnedAt" TIMESTAMP(3),
    "resolutionBreachedAt" TIMESTAMP(3),
    "reopenedCount" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

CONSTRAINT "CrmCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmCaseEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "kind" "CrmCaseEventKind" NOT NULL,
    "byUserId" TEXT,
    "byName" TEXT NOT NULL,
    "note" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "CrmCaseEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmRenewalLink" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "CrmRenewalLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CrmSlaPolicy_organizationId_accountKey_priority_key" ON "CrmSlaPolicy"("organizationId", "accountKey", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "CrmBusinessHours_organizationId_key" ON "CrmBusinessHours"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmHoliday_organizationId_date_key" ON "CrmHoliday"("organizationId", "date");

-- CreateIndex
CREATE INDEX "CrmCase_organizationId_status_priority_idx" ON "CrmCase"("organizationId", "status", "priority");

-- CreateIndex
CREATE INDEX "CrmCase_organizationId_accountId_idx" ON "CrmCase"("organizationId", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmCase_organizationId_number_key" ON "CrmCase"("organizationId", "number");

-- CreateIndex
CREATE INDEX "CrmCaseEvent_caseId_at_idx" ON "CrmCaseEvent"("caseId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "CrmRenewalLink_contractId_key" ON "CrmRenewalLink"("contractId");

-- AddForeignKey
ALTER TABLE "CrmSlaPolicy" ADD CONSTRAINT "CrmSlaPolicy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmSlaPolicy" ADD CONSTRAINT "CrmSlaPolicy_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "CrmAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmBusinessHours" ADD CONSTRAINT "CrmBusinessHours_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmHoliday" ADD CONSTRAINT "CrmHoliday_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmCase" ADD CONSTRAINT "CrmCase_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmCase" ADD CONSTRAINT "CrmCase_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "CrmAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmCaseEvent" ADD CONSTRAINT "CrmCaseEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmCaseEvent" ADD CONSTRAINT "CrmCaseEvent_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "CrmCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmRenewalLink" ADD CONSTRAINT "CrmRenewalLink_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The history of a case is never changed.
CREATE OR REPLACE FUNCTION crm_case_event_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'A case history record cannot be changed or deleted.' USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CrmCaseEvent_immutable" BEFORE UPDATE OR DELETE ON "CrmCaseEvent" FOR EACH ROW EXECUTE FUNCTION crm_case_event_immutable();
