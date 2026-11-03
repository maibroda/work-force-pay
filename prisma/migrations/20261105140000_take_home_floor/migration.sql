-- The take-home floor: a payroll rule setting (% of gross) that limits loan and salary-advance recoveries so net pay is not taken below it. A client-specific policy,
-- not a statutory one, so the default is 0 (no floor) and no existing payroll changes. To reverse, run down.sql in this folder (Prisma runs only migration.sql).
ALTER TABLE "PayrollRule" ADD COLUMN "minTakeHomePctOfGross" DECIMAL(5,2) NOT NULL DEFAULT 0;
