-- CreateEnum
CREATE TYPE "HourlyLeaveBasis" AS ENUM ('ALL_PAY', 'BASIC');

-- AlterTable: every EXISTING rule version keeps the first build's basis (the whole pay), so no past or open payroll changes; a NEW version starts on the Basic part
ALTER TABLE "PayrollRule" ADD COLUMN     "hourlyLeaveBasis" "HourlyLeaveBasis" NOT NULL DEFAULT 'ALL_PAY';
ALTER TABLE "PayrollRule" ALTER COLUMN "hourlyLeaveBasis" SET DEFAULT 'BASIC';
