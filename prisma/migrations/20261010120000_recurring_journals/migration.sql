-- CreateEnum
CREATE TYPE "RecurrenceFrequency" AS ENUM ('MONTHLY', 'QUARTERLY', 'YEARLY');

-- AlterTable
ALTER TABLE "JournalDocument" ADD COLUMN     "recurringJournalId" TEXT;

-- CreateTable
CREATE TABLE "RecurringJournal" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "JournalDocumentKind" NOT NULL DEFAULT 'MANUAL',
    "description" TEXT NOT NULL,
    "frequency" "RecurrenceFrequency" NOT NULL DEFAULT 'MONTHLY',
    "monthEnd" BOOLEAN NOT NULL DEFAULT false,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "nextRunDate" DATE,
    "generatedCount" INTEGER NOT NULL DEFAULT 0,
    "reverseAfterDays" INTEGER,
    "autoSubmit" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy" TEXT NOT NULL,
    "updatedByUserId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "lastRunNote" TEXT,

    CONSTRAINT "RecurringJournal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringJournalLine" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "debit" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "dimensions" JSONB,

    CONSTRAINT "RecurringJournalLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecurringJournal_organizationId_active_nextRunDate_idx" ON "RecurringJournal"("organizationId", "active", "nextRunDate");

-- CreateIndex
CREATE INDEX "RecurringJournalLine_templateId_idx" ON "RecurringJournalLine"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "JournalDocument_recurringJournalId_postingDate_key" ON "JournalDocument"("recurringJournalId", "postingDate");

-- AddForeignKey
ALTER TABLE "JournalDocument" ADD CONSTRAINT "JournalDocument_recurringJournalId_fkey" FOREIGN KEY ("recurringJournalId") REFERENCES "RecurringJournal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringJournal" ADD CONSTRAINT "RecurringJournal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringJournalLine" ADD CONSTRAINT "RecurringJournalLine_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "RecurringJournal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringJournalLine" ADD CONSTRAINT "RecurringJournalLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "GlAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

