-- Reverses 20261207090000_engagement_surveys. Everything it added is new, so nothing that existed before is touched.
-- Dropping the tables removes any surveys, access codes, answers and kept results recorded since (take a backup first if any matter).
DROP TABLE "SurveyAggregate";
DROP TABLE "SurveyKioskSession";
DROP TABLE "SurveyAnswer";
DROP TABLE "SurveyResponse";
DROP TABLE "SurveyAccessCode";
DROP TABLE "SurveyQuestion";
DROP TABLE "Survey";
ALTER TABLE "HrPolicy" DROP COLUMN "surveyRetentionMonths";
DROP TYPE "SurveyCodeStatus";
DROP TYPE "SurveyQuestionKind";
DROP TYPE "SurveyStatus";
