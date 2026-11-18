-- Reverses 20261223090000_probation_reconsideration: removes the failed-probation reconsideration tables, their status enum and the company settings.
-- Destructive for any reconsideration already made (the justifications, conditions and statements are deleted): take a backup first if the feature has been used.
-- A probation already extended through a reconsideration KEEPS its extension: that is recorded on the contract and in the probation decision history, not here.
DROP TABLE "ProbationExpectation";
DROP TABLE "ProbationReconsideration";
DROP TYPE "ReconsiderationStatus";
ALTER TABLE "HrPolicy" DROP COLUMN "reconsiderationEnabled",
DROP COLUMN "reconsiderationWindowDays",
DROP COLUMN "probationCeilingMonths",
DROP COLUMN "reconsiderationMax",
DROP COLUMN "reconsiderationMinJustification",
DROP COLUMN "reconsiderationMinExpectations";
