-- Reverses 20261215090000_recruitment_screening. Drops the three new tables (children first) and the three enums.
-- Screening criteria, answers and shortlist decisions recorded since the migration are lost by this. Take a backup first if screening has been used.

DROP TABLE "CandidateShortlist";
DROP TABLE "CandidateScreening";
DROP TABLE "ScreeningCriterion";

DROP TYPE "ShortlistDecision";
DROP TYPE "ScreeningOutcome";
DROP TYPE "ScreeningKind";
