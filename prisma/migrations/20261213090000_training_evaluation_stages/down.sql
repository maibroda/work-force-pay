-- Reverses 20261213090000_training_evaluation_stages. Only what it added is dropped: the effectiveness answers and their type, the three extra participant ratings, the programme flag and the policy setting. Nothing else is touched.
DROP TABLE "TrainingEffectiveness";
DROP TYPE "TrainingEffectivenessOutcome";
ALTER TABLE "TrainingEvaluation" DROP COLUMN "contentRating", DROP COLUMN "facilitatorRating", DROP COLUMN "deliveryRating";
ALTER TABLE "TrainingProgramme" DROP COLUMN "evaluateEffectiveness";
ALTER TABLE "HrPolicy" DROP COLUMN "trainingEffectivenessDays";
