-- Reverses 20261210090000_second_person_rules. Only what it added is dropped: the resolver, raiser, proposer and decider ids, the "single holder" flags with their reasons, and the
-- succession status (with its type). Every case, sanction and successor keeps its other data; a PROPOSED successor row stays as a plain successor row.
ALTER TABLE "SuccessionCandidate" DROP COLUMN "decidedAt", DROP COLUMN "decidedByUserId", DROP COLUMN "proposedByUserId", DROP COLUMN "singleHolder", DROP COLUMN "singleReason", DROP COLUMN "status";
ALTER TABLE "RelationsCase" DROP COLUMN "closedSingleHolder", DROP COLUMN "closedSingleReason", DROP COLUMN "resolvedByUserId";
ALTER TABLE "DisciplinaryRecord" DROP COLUMN "approvedByUserId", DROP COLUMN "approvedSingleHolder", DROP COLUMN "approvedSingleReason", DROP COLUMN "issuedByUserId";
DROP TYPE "SuccessionStatus";
