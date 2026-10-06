-- AlterTable
ALTER TABLE "HrPolicy" ADD COLUMN     "probationMinScore" DECIMAL(3,2) NOT NULL DEFAULT 0,
ADD COLUMN     "probationRequiresAppraisal" BOOLEAN NOT NULL DEFAULT false;

