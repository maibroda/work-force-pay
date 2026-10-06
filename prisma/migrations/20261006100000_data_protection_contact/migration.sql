-- AlterTable
ALTER TABLE "HrPolicy" ADD COLUMN     "breachRunbook" TEXT,
ADD COLUMN     "dpoEmail" TEXT,
ADD COLUMN     "dpoName" TEXT,
ADD COLUMN     "dpoPhone" TEXT,
ADD COLUMN     "regulatorContact" TEXT,
ADD COLUMN     "regulatorName" TEXT NOT NULL DEFAULT 'Nigeria Data Protection Commission';

