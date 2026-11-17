-- Reverses 20261221090000_internal_move: removes the link from a promotion proposal to a candidate and the "moved internally" candidate stage.
-- A candidate already marked as moved internally goes back to the offer stage (where they were when the move started); the promotion proposals themselves stay, without the link.
-- Take a backup first if internal moves have been made.

ALTER TABLE "PromotionProposal" DROP CONSTRAINT "PromotionProposal_candidateId_fkey";
DROP INDEX "PromotionProposal_candidateId_idx";
ALTER TABLE "PromotionProposal" DROP COLUMN "candidateId";

UPDATE "Candidate" SET "stage" = 'OFFER' WHERE "stage" = 'MOVED';
ALTER TYPE "CandidateStage" RENAME TO "CandidateStage_old";
CREATE TYPE "CandidateStage" AS ENUM ('APPLIED', 'SCREENING', 'INTERVIEW', 'ASSESSMENT', 'OFFER', 'HIRED', 'REJECTED', 'WITHDRAWN');
ALTER TABLE "Candidate" ALTER COLUMN "stage" DROP DEFAULT;
ALTER TABLE "Candidate" ALTER COLUMN "stage" TYPE "CandidateStage" USING ("stage"::text::"CandidateStage");
ALTER TABLE "Candidate" ALTER COLUMN "stage" SET DEFAULT 'APPLIED';
DROP TYPE "CandidateStage_old";
