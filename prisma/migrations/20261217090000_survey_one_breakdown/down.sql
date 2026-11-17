-- Reverses 20261217090000_survey_one_breakdown. Drops the survey's breakdown choice and its enum.
-- A survey's results would again be built with BOTH the role and the department breakdown, which let a reader subtract one from the other and recover a small group the rules hide
-- (measured 2026-11-17). Only reverse this if a replacement control is in place.

ALTER TABLE "Survey" DROP COLUMN "breakdownBy";

DROP TYPE "SurveyBreakdown";
