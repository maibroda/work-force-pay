-- Reverses migration.sql. EVERY PERFORMANCE IMPROVEMENT PLAN, ITS OBJECTIVES, REVIEWS AND THE EMPLOYEES' RESPONSES ARE LOST, and the five plan limits on the HR policy.
-- Nothing else is touched: appraisals, employees and the audit log (which keeps its PIP_* entries) are unchanged. Take a copy of the four tables first if they have been used for real.
DROP TABLE "PipReviewAssessment";
DROP TABLE "PipReview";
DROP TABLE "PipObjective";
DROP TABLE "PerformanceImprovementPlan";
ALTER TABLE "HrPolicy" DROP COLUMN "pipDefaultDays", DROP COLUMN "pipMaxDays", DROP COLUMN "pipMaxExtensions", DROP COLUMN "pipMaxExtensionDays", DROP COLUMN "pipReviewIntervalDays";
DROP TYPE "PipObjectiveResult";
DROP TYPE "PipOutcome";
DROP TYPE "PipStatus";
