-- AlterTable
ALTER TABLE "Candidate" ADD COLUMN     "anonymizedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "HrPolicy" ADD COLUMN     "candidateRetentionMonths" INTEGER NOT NULL DEFAULT 24;

