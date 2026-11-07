-- Reverses migration.sql. Every job description, KPI and KPI result on an appraisal, each cycle's KPI share and the company's own KPI bands are LOST:
-- afterwards every appraisal scores on its criteria ratings alone. Appraisals already approved keep their stored overall score (it is not recalculated).
-- Take a copy of these tables first if they have been used for real.
DROP TABLE "AppraisalKpi";
DROP TABLE "Kpi";
ALTER TABLE "Appraisal" DROP CONSTRAINT "Appraisal_jobDescriptionId_fkey";
ALTER TABLE "Appraisal" DROP COLUMN "criteriaScore", DROP COLUMN "jobDescriptionId", DROP COLUMN "kpiScore";
DROP TABLE "JobDescription";
ALTER TABLE "AppraisalCycle" DROP COLUMN "kpiSharePct";
ALTER TABLE "HrPolicy" DROP COLUMN "kpiBands";
DROP TYPE "JobDescriptionStatus";
DROP TYPE "KpiDirection";
DROP TYPE "KpiUnit";
