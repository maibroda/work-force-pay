-- CreateEnum
CREATE TYPE "PolicyKind" AS ENUM ('POLICY', 'HANDBOOK', 'SOP');

-- AlterTable
ALTER TABLE "CompanyPolicy" ADD COLUMN     "acknowledgementRequired" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "kind" "PolicyKind" NOT NULL DEFAULT 'POLICY',
ADD COLUMN     "reviewDueOn" DATE;

