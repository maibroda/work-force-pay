-- AlterEnum
ALTER TYPE "CandidateStage" ADD VALUE 'MOVED';

-- AlterTable
ALTER TABLE "PromotionProposal" ADD COLUMN     "candidateId" TEXT;

-- CreateIndex
CREATE INDEX "PromotionProposal_candidateId_idx" ON "PromotionProposal"("candidateId");

-- AddForeignKey
ALTER TABLE "PromotionProposal" ADD CONSTRAINT "PromotionProposal_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

