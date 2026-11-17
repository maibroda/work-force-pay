-- CreateEnum
CREATE TYPE "SurveyBreakdown" AS ENUM ('ROLE', 'DEPARTMENT');

-- AlterTable
ALTER TABLE "Survey" ADD COLUMN     "breakdownBy" "SurveyBreakdown" NOT NULL DEFAULT 'ROLE';

