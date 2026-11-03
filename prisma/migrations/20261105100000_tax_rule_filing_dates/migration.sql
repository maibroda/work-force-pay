-- PAYE filing dates and the late penalty as tax rule data (rule 3). All four columns are nullable ("not set") and no row is rewritten.
-- To reverse, run down.sql in this folder (Prisma runs only migration.sql).
ALTER TABLE "TaxRule" ADD COLUMN "payeDueDay" INTEGER;
ALTER TABLE "TaxRule" ADD COLUMN "annualReturnMonth" INTEGER;
ALTER TABLE "TaxRule" ADD COLUMN "annualReturnDay" INTEGER;
ALTER TABLE "TaxRule" ADD COLUMN "latePenaltyPct" DECIMAL(6,3);
