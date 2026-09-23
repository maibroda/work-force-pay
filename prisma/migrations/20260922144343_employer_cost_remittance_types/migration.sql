-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "RemittanceType" ADD VALUE 'ITF';
ALTER TYPE "RemittanceType" ADD VALUE 'NSITF';
ALTER TYPE "RemittanceType" ADD VALUE 'NHF_MEDICAL';
ALTER TYPE "RemittanceType" ADD VALUE 'INSURANCE';
ALTER TYPE "RemittanceType" ADD VALUE 'UNIFORM_KITS';
ALTER TYPE "RemittanceType" ADD VALUE 'RECRUITMENT_TRAINING';
ALTER TYPE "RemittanceType" ADD VALUE 'LEAVE_RELIEVER';
ALTER TYPE "RemittanceType" ADD VALUE 'OUTSOURCING_LEAVE_ALLOWANCE';
