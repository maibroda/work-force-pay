-- Reverses migration.sql. The filing dates and penalty values are lost; nothing else changes.
ALTER TABLE "TaxRule" DROP COLUMN "latePenaltyPct";
ALTER TABLE "TaxRule" DROP COLUMN "annualReturnDay";
ALTER TABLE "TaxRule" DROP COLUMN "annualReturnMonth";
ALTER TABLE "TaxRule" DROP COLUMN "payeDueDay";
