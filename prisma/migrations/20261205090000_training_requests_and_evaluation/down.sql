-- Reverses 20261205090000_training_requests_and_evaluation. Everything it added is new, so nothing that existed before is touched.
-- Dropping the tables removes any training requests and evaluations recorded since (take a backup first if any matter).
DROP TABLE "TrainingEvaluation";
DROP TABLE "TrainingRequest";
ALTER TABLE "HrPolicy" DROP COLUMN "trainingEvaluationDays";
DROP TYPE "TrainingEvaluationKind";
DROP TYPE "TrainingRequestStatus";
