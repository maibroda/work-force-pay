-- Reverses migration.sql. The state values are lost; nothing else changes.
ALTER TABLE "PayrollRecord" DROP COLUMN "payeState";
ALTER TABLE "Employee" DROP COLUMN "stateOfResidence";
