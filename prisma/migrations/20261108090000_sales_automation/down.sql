-- Reverses migration.sql. Every automation rule, run record and in-app notification is lost.
DROP TABLE "CrmNotification";
DROP TABLE "CrmAutomationRun";
DROP TABLE "CrmAutomationRule";
DROP TYPE "CrmAutomationRunStatus";
DROP TYPE "CrmAutomationAction";
DROP TYPE "CrmAutomationTrigger";
