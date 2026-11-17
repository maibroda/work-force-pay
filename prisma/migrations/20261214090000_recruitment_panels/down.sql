-- Reverses 20261214090000_recruitment_panels. Drops the four new tables (children first), the two columns on Interview and the enum.
-- Panel scorecards, criteria and selections recorded since the migration are lost by this; the existing interview scores, recommendations and feedback are untouched.
-- Take a backup first if any panel has been used.

DROP TABLE "CandidateSelection";
DROP TABLE "ScorecardScore";
DROP TABLE "RequisitionCriterion";
DROP TABLE "InterviewPanelMember";

ALTER TABLE "Interview" DROP COLUMN "panelClosedAt",
DROP COLUMN "panelClosedBy";

DROP TYPE "SelectionStatus";
