-- CreateEnum
CREATE TYPE "SuccessionStatus" AS ENUM ('PROPOSED', 'APPROVED');

-- AlterTable
ALTER TABLE "DisciplinaryRecord" ADD COLUMN     "approvedByUserId" TEXT,
ADD COLUMN     "approvedSingleHolder" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "approvedSingleReason" TEXT,
ADD COLUMN     "issuedByUserId" TEXT;

-- AlterTable
ALTER TABLE "RelationsCase" ADD COLUMN     "closedSingleHolder" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "closedSingleReason" TEXT,
ADD COLUMN     "resolvedByUserId" TEXT;

-- AlterTable
ALTER TABLE "SuccessionCandidate" ADD COLUMN     "decidedAt" TIMESTAMP(3),
ADD COLUMN     "decidedByUserId" TEXT,
ADD COLUMN     "proposedByUserId" TEXT,
ADD COLUMN     "singleHolder" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "singleReason" TEXT,
ADD COLUMN     "status" "SuccessionStatus" NOT NULL DEFAULT 'APPROVED';

