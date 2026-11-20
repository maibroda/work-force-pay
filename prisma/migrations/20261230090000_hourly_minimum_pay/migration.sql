-- AlterTable: the minimum monthly pay for a person paid only by the hour (the founder's H13). 0 (the default) means no check, so every existing rule keeps working exactly as before.
ALTER TABLE "PayrollRule" ADD COLUMN "hourlyMinMonthlyPay" DECIMAL(14,2) NOT NULL DEFAULT 0;
