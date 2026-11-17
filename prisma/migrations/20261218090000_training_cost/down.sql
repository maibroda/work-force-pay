-- Reverses 20261218090000_training_cost. Drops the budget and cost-line tables (the cost line first, with its self-link), the approval-threshold setting and the two enums.
-- Every recorded training cost line and budget is lost by this. Take a backup first if training costs have been recorded.

DROP TABLE "TrainingBudget";
DROP TABLE "TrainingCostLine";

ALTER TABLE "HrPolicy" DROP COLUMN "trainingCostApprovalThreshold";

DROP TYPE "TrainingCostStatus";
DROP TYPE "TrainingCostKind";
