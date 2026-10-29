-- The voluntary NHF (National Housing Fund) contribution: 2.5% of basic pay, taken only from employees who have chosen to contribute, remitted by the end
-- of the month. The rate is a payroll rule setting (default 2.5, 0 = none); each employee carries the choice (default NOT chosen) and the day they made it.
-- Nobody has chosen it, so no existing payroll changes. To reverse, run down.sql in this folder (Prisma runs only migration.sql).
ALTER TABLE "PayrollRule" ADD COLUMN "nhfEmployeeRatePct" DECIMAL(5,3) NOT NULL DEFAULT 2.5;
ALTER TABLE "Employee" ADD COLUMN "nhfContributes" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Employee" ADD COLUMN "nhfOptedInOn" DATE;
