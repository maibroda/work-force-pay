-- Reverses migration.sql: every team's place in its rotation is lost (it starts again from the first member).
ALTER TABLE "CrmTeam" DROP COLUMN "assignmentCursor";
