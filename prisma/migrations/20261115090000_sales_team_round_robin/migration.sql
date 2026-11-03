-- Sales round robin by team (a sales manager's new leads are shared out among the members of their own team): each team keeps its own place in the rotation.
-- One column with a default; nothing existing is changed. To reverse, run down.sql in this folder (Prisma runs only migration.sql).
ALTER TABLE "CrmTeam" ADD COLUMN     "assignmentCursor" INTEGER NOT NULL DEFAULT 0;
