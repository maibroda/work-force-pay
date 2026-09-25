
-- DropForeignKey
ALTER TABLE "JournalEntry" DROP CONSTRAINT "JournalEntry_runId_fkey";

-- AlterTable
ALTER TABLE "JournalEntry" ALTER COLUMN "runId" DROP NOT NULL,
ALTER COLUMN "periodName" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "JournalEntry_organizationId_source_idx" ON "JournalEntry"("organizationId", "source");

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PayrollRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

