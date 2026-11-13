-- Reverses 20261209090000_probation_workflow. Everything it added is dropped and nothing it did not add is touched: the decision record (ProbationDecision) and
-- every contract keep their data; only the new review rows, the designated deciders, the two HR policy settings and the link from a decision to its review go.
ALTER TABLE "ProbationDecision" DROP CONSTRAINT "ProbationDecision_reviewId_fkey";
DROP INDEX "ProbationDecision_reviewId_key";
ALTER TABLE "ProbationDecision" DROP COLUMN "reviewId";
DROP TABLE "ProbationReview";
DROP TABLE "ProbationDecider";
ALTER TABLE "HrPolicy" DROP COLUMN "probationResponseDays", DROP COLUMN "probationWorkflow";
DROP TYPE "ProbationReviewStatus";
DROP TYPE "ProbationRecommendation";
