-- Sales Phase 4 (docs/crm/04-phase-4-plan.md): activities (calls, meetings, site surveys, WhatsApp, email, notes), tasks, and the record that a day's digest email was sent.
-- New tables only (nothing existing is changed). The database refuses to delete an activity or to change what it says: a mistaken one is voided with a reason.
-- To reverse, run down.sql in this folder (Prisma runs only migration.sql).

-- CreateEnum
CREATE TYPE "CrmActivityKind" AS ENUM ('CALL', 'MEETING', 'SITE_SURVEY', 'WHATSAPP', 'EMAIL', 'NOTE');

-- CreateEnum
CREATE TYPE "CrmCallOutcome" AS ENUM ('REACHED', 'NO_ANSWER', 'CALLBACK', 'WRONG_NUMBER');

-- CreateEnum
CREATE TYPE "CrmMessagePurpose" AS ENUM ('SERVICE', 'MARKETING');

-- CreateEnum
CREATE TYPE "CrmTaskStatus" AS ENUM ('OPEN', 'DONE', 'CANCELLED');

-- CreateTable
CREATE TABLE "CrmActivity" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" "CrmActivityKind" NOT NULL,
    "leadId" TEXT,
    "accountId" TEXT,
    "contactId" TEXT,
    "opportunityId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subject" TEXT,
    "body" TEXT,
    "callOutcome" "CrmCallOutcome",
    "survey" JSONB,
    "purpose" "CrmMessagePurpose",
    "viaLink" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    "voidedBy" TEXT,
    "voidReason" TEXT,

CONSTRAINT "CrmActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmTask" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "reminderAt" TIMESTAMP(3),
    "status" "CrmTaskStatus" NOT NULL DEFAULT 'OPEN',
    "ownerUserId" TEXT NOT NULL,
    "ownerName" TEXT NOT NULL,
    "leadId" TEXT,
    "accountId" TEXT,
    "contactId" TEXT,
    "opportunityId" TEXT,
    "completedAt" TIMESTAMP(3),
    "completedBy" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

CONSTRAINT "CrmTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmDigestRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "forDate" DATE NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "CrmDigestRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CrmActivity_organizationId_leadId_occurredAt_idx" ON "CrmActivity"("organizationId", "leadId", "occurredAt");

-- CreateIndex
CREATE INDEX "CrmActivity_organizationId_accountId_occurredAt_idx" ON "CrmActivity"("organizationId", "accountId", "occurredAt");

-- CreateIndex
CREATE INDEX "CrmActivity_organizationId_contactId_occurredAt_idx" ON "CrmActivity"("organizationId", "contactId", "occurredAt");

-- CreateIndex
CREATE INDEX "CrmActivity_organizationId_opportunityId_occurredAt_idx" ON "CrmActivity"("organizationId", "opportunityId", "occurredAt");

-- CreateIndex
CREATE INDEX "CrmTask_organizationId_ownerUserId_status_dueAt_idx" ON "CrmTask"("organizationId", "ownerUserId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "CrmTask_opportunityId_idx" ON "CrmTask"("opportunityId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmDigestRun_organizationId_userId_forDate_key" ON "CrmDigestRun"("organizationId", "userId", "forDate");

-- AddForeignKey
ALTER TABLE "CrmActivity" ADD CONSTRAINT "CrmActivity_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmActivity" ADD CONSTRAINT "CrmActivity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "CrmLead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmActivity" ADD CONSTRAINT "CrmActivity_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "CrmAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmActivity" ADD CONSTRAINT "CrmActivity_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "CrmContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmActivity" ADD CONSTRAINT "CrmActivity_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "CrmOpportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmTask" ADD CONSTRAINT "CrmTask_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmTask" ADD CONSTRAINT "CrmTask_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "CrmLead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmTask" ADD CONSTRAINT "CrmTask_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "CrmAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmTask" ADD CONSTRAINT "CrmTask_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "CrmContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmTask" ADD CONSTRAINT "CrmTask_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "CrmOpportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmDigestRun" ADD CONSTRAINT "CrmDigestRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- An activity is never deleted, and only its void fields may change, once.
CREATE OR REPLACE FUNCTION crm_activity_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'An activity cannot be deleted. Void it with a reason instead.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."voidedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'A voided activity cannot be changed.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (to_jsonb(NEW) - 'voidedAt' - 'voidedBy' - 'voidReason') IS DISTINCT FROM (to_jsonb(OLD) - 'voidedAt' - 'voidedBy' - 'voidReason') THEN
    RAISE EXCEPTION 'What an activity says cannot be changed. Void it with a reason and log a new one.' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CrmActivity_guard" BEFORE UPDATE OR DELETE ON "CrmActivity" FOR EACH ROW EXECUTE FUNCTION crm_activity_guard();
