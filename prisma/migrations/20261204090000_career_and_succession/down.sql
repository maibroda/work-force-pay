-- Reverses 20261204090000_career_and_succession. Everything it added is new, so nothing that existed before is touched.
-- Dropping the tables removes any career paths, promotion proposals and succession entries recorded since (take a backup first if any matter).
DROP TABLE "SuccessionCandidate";
DROP TABLE "SuccessionRole";
DROP TABLE "PromotionProposal";
DROP TABLE "CareerPath";
ALTER TABLE "HrPolicy" DROP COLUMN "promotionApplyAlertDays";
DROP TYPE "SuccessionReadiness";
DROP TYPE "PromotionStatus";
