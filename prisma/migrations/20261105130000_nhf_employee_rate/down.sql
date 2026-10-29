-- Reverses migration.sql. The rate and each employee's choice are lost; nothing else changes.
ALTER TABLE "Employee" DROP COLUMN "nhfOptedInOn";
ALTER TABLE "Employee" DROP COLUMN "nhfContributes";
ALTER TABLE "PayrollRule" DROP COLUMN "nhfEmployeeRatePct";
