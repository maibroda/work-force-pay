-- Reverses migration.sql. The setting is lost; nothing else changes.
ALTER TABLE "PayrollRule" DROP COLUMN "minTakeHomePctOfGross";
