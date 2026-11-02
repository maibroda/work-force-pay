-- Editable defaults for decisions that were open: whether a missing state of residence blocks approval (payroll rule), and who is told about the audit log.
-- Columns with defaults only; nothing existing is rewritten and behaviour is unchanged until someone edits a setting.
-- To reverse, run down.sql in this folder (Prisma runs only migration.sql).
ALTER TABLE "PayrollRule" ADD COLUMN "requirePayeState" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "HrPolicy" ADD COLUMN "auditAlertEmails" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "HrPolicy" ADD COLUMN "auditAlertIncludeEveryone" BOOLEAN NOT NULL DEFAULT true;
