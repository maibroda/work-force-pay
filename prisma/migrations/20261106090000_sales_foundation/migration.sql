-- Sales and account management foundation (docs/crm/01-phase-1a-plan.md): the on/off switch, accounts, contacts, leads and consent records.
-- New tables and types only; no existing table is changed. A trigger makes consent records permanent (a change is a new record).
-- To reverse, run down.sql in this folder (Prisma runs only migration.sql).

-- CreateEnum
CREATE TYPE "CrmMode" AS ENUM ('CLASSIC', 'SIMPLE');

-- CreateEnum
CREATE TYPE "CrmRecordStatus" AS ENUM ('ACTIVE', 'VOID');

-- CreateEnum
CREATE TYPE "CrmAccountType" AS ENUM ('PROSPECT', 'CLIENT', 'FORMER_CLIENT');

-- CreateEnum
CREATE TYPE "CrmSource" AS ENUM ('REFERRAL', 'WALK_IN', 'PHONE', 'WEBSITE', 'WHATSAPP', 'TENDER', 'EVENT', 'EXISTING_CLIENT', 'OTHER');

-- CreateEnum
CREATE TYPE "CrmServiceInterest" AS ENUM ('GUARDING', 'CLEANING', 'FACILITY', 'STAFFING', 'OTHER');

-- CreateEnum
CREATE TYPE "CrmDecisionRole" AS ENUM ('DECISION_MAKER', 'INFLUENCER', 'USER', 'FINANCE', 'PROCUREMENT', 'GATEKEEPER');

-- CreateEnum
CREATE TYPE "CrmLeadStatus" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'UNQUALIFIED', 'CONVERTED', 'VOID');

-- CreateEnum
CREATE TYPE "CrmConsentPurpose" AS ENUM ('MARKETING', 'SERVICE');

-- CreateEnum
CREATE TYPE "CrmConsentStatus" AS ENUM ('GRANTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "CrmChannel" AS ENUM ('EMAIL', 'WHATSAPP', 'SMS', 'PHONE', 'IN_PERSON', 'WEB_FORM', 'OTHER');

-- CreateTable
CREATE TABLE "CrmSetting" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "mode" "CrmMode" NOT NULL DEFAULT 'CLASSIC',
    "updatedBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmAccount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "industry" TEXT,
    "accountType" "CrmAccountType" NOT NULL DEFAULT 'PROSPECT',
    "ownerUserId" TEXT NOT NULL,
    "ownerName" TEXT NOT NULL,
    "parentAccountId" TEXT,
    "source" "CrmSource",
    "sourceDetail" TEXT,
    "state" TEXT,
    "lga" TEXT,
    "address" TEXT,
    "rcNumber" TEXT,
    "emailDomain" TEXT,
    "clientId" TEXT,
    "status" "CrmRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "voidedAt" TIMESTAMP(3),
    "voidedBy" TEXT,
    "voidReason" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmContact" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "accountId" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "jobTitle" TEXT,
    "roleInDecision" "CrmDecisionRole",
    "phoneE164" TEXT,
    "whatsappE164" TEXT,
    "email" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "ownerUserId" TEXT NOT NULL,
    "ownerName" TEXT NOT NULL,
    "status" "CrmRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "voidedAt" TIMESTAMP(3),
    "voidedBy" TEXT,
    "voidReason" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmLead" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "contactName" TEXT,
    "jobTitle" TEXT,
    "phoneE164" TEXT,
    "email" TEXT,
    "industry" TEXT,
    "state" TEXT,
    "lga" TEXT,
    "address" TEXT,
    "source" "CrmSource" NOT NULL DEFAULT 'OTHER',
    "sourceDetail" TEXT,
    "estimatedGuards" INTEGER,
    "serviceInterest" "CrmServiceInterest" NOT NULL DEFAULT 'OTHER',
    "status" "CrmLeadStatus" NOT NULL DEFAULT 'NEW',
    "unqualifiedReason" TEXT,
    "ownerUserId" TEXT NOT NULL,
    "ownerName" TEXT NOT NULL,
    "convertedAccountId" TEXT,
    "convertedContactId" TEXT,
    "convertedAt" TIMESTAMP(3),
    "convertedBy" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidedBy" TEXT,
    "voidReason" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmConsent" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT,
    "leadId" TEXT,
    "purpose" "CrmConsentPurpose" NOT NULL,
    "status" "CrmConsentStatus" NOT NULL,
    "channel" "CrmChannel" NOT NULL,
    "source" TEXT NOT NULL,
    "evidenceRef" TEXT,
    "recordedBy" TEXT NOT NULL,
    "recordedByUserId" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmConsent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CrmSetting_organizationId_key" ON "CrmSetting"("organizationId");

-- CreateIndex
CREATE INDEX "CrmAccount_organizationId_ownerUserId_status_idx" ON "CrmAccount"("organizationId", "ownerUserId", "status");

-- CreateIndex
CREATE INDEX "CrmAccount_organizationId_normalizedName_idx" ON "CrmAccount"("organizationId", "normalizedName");

-- CreateIndex
CREATE INDEX "CrmContact_organizationId_ownerUserId_status_idx" ON "CrmContact"("organizationId", "ownerUserId", "status");

-- CreateIndex
CREATE INDEX "CrmContact_organizationId_phoneE164_idx" ON "CrmContact"("organizationId", "phoneE164");

-- CreateIndex
CREATE INDEX "CrmContact_organizationId_email_idx" ON "CrmContact"("organizationId", "email");

-- CreateIndex
CREATE INDEX "CrmContact_accountId_idx" ON "CrmContact"("accountId");

-- CreateIndex
CREATE INDEX "CrmLead_organizationId_ownerUserId_status_idx" ON "CrmLead"("organizationId", "ownerUserId", "status");

-- CreateIndex
CREATE INDEX "CrmLead_organizationId_phoneE164_idx" ON "CrmLead"("organizationId", "phoneE164");

-- CreateIndex
CREATE INDEX "CrmLead_organizationId_email_idx" ON "CrmLead"("organizationId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "CrmLead_organizationId_number_key" ON "CrmLead"("organizationId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "CrmConsent_seq_key" ON "CrmConsent"("seq");

-- CreateIndex
CREATE INDEX "CrmConsent_contactId_purpose_seq_idx" ON "CrmConsent"("contactId", "purpose", "seq");

-- CreateIndex
CREATE INDEX "CrmConsent_leadId_purpose_seq_idx" ON "CrmConsent"("leadId", "purpose", "seq");

-- CreateIndex
CREATE INDEX "CrmConsent_organizationId_idx" ON "CrmConsent"("organizationId");

-- AddForeignKey
ALTER TABLE "CrmSetting" ADD CONSTRAINT "CrmSetting_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmAccount" ADD CONSTRAINT "CrmAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmAccount" ADD CONSTRAINT "CrmAccount_parentAccountId_fkey" FOREIGN KEY ("parentAccountId") REFERENCES "CrmAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmContact" ADD CONSTRAINT "CrmContact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmContact" ADD CONSTRAINT "CrmContact_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "CrmAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmLead" ADD CONSTRAINT "CrmLead_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmConsent" ADD CONSTRAINT "CrmConsent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmConsent" ADD CONSTRAINT "CrmConsent_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "CrmContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmConsent" ADD CONSTRAINT "CrmConsent_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "CrmLead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A consent record is never changed or removed: a withdrawal is a new row, and the latest row decides.
CREATE OR REPLACE FUNCTION crm_consent_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'A consent record cannot be changed or deleted. Record a new one instead.' USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CrmConsent_immutable" BEFORE UPDATE OR DELETE ON "CrmConsent" FOR EACH ROW EXECUTE FUNCTION crm_consent_immutable();
