-- Reverses migration.sql. Every activity, task and digest record is lost.
DROP TRIGGER "CrmActivity_guard" ON "CrmActivity";
DROP FUNCTION crm_activity_guard();
DROP TABLE "CrmDigestRun";
DROP TABLE "CrmTask";
DROP TABLE "CrmActivity";
DROP TYPE "CrmTaskStatus";
DROP TYPE "CrmMessagePurpose";
DROP TYPE "CrmCallOutcome";
DROP TYPE "CrmActivityKind";
