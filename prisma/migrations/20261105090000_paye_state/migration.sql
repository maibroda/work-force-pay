-- PAYE by state of residence: the state on the employee, and a copy of it on each payroll record.
-- Both columns are nullable and nothing existing is rewritten; old locked payrolls keep an empty state.
-- To reverse, run down.sql in this folder (Prisma runs only migration.sql).
ALTER TABLE "Employee" ADD COLUMN "stateOfResidence" TEXT;
ALTER TABLE "PayrollRecord" ADD COLUMN "payeState" TEXT;
