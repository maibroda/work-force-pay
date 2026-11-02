-- Reverses migration.sql. The three settings are lost; nothing else changes.
ALTER TABLE "HrPolicy" DROP COLUMN "auditAlertIncludeEveryone";
ALTER TABLE "HrPolicy" DROP COLUMN "auditAlertEmails";
ALTER TABLE "PayrollRule" DROP COLUMN "requirePayeState";
