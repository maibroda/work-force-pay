-- CreateEnum
CREATE TYPE "TrainingEffectivenessOutcome" AS ENUM ('CLEARLY_IMPROVED', 'SOMEWHAT_IMPROVED', 'NO_VISIBLE_CHANGE', 'NOT_YET_VISIBLE');

-- AlterTable
ALTER TABLE "HrPolicy" ADD COLUMN     "trainingEffectivenessDays" INTEGER NOT NULL DEFAULT 120;

-- AlterTable
ALTER TABLE "TrainingEvaluation" ADD COLUMN     "contentRating" INTEGER,
ADD COLUMN     "deliveryRating" INTEGER,
ADD COLUMN     "facilitatorRating" INTEGER;

-- AlterTable
ALTER TABLE "TrainingProgramme" ADD COLUMN     "evaluateEffectiveness" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "TrainingEffectiveness" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "enrolmentId" TEXT NOT NULL,
    "outcome" "TrainingEffectivenessOutcome" NOT NULL,
    "comment" TEXT,
    "byUserId" TEXT NOT NULL,
    "byName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainingEffectiveness_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrainingEffectiveness_enrolmentId_key" ON "TrainingEffectiveness"("enrolmentId");

-- CreateIndex
CREATE INDEX "TrainingEffectiveness_organizationId_outcome_idx" ON "TrainingEffectiveness"("organizationId", "outcome");

-- AddForeignKey
ALTER TABLE "TrainingEffectiveness" ADD CONSTRAINT "TrainingEffectiveness_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingEffectiveness" ADD CONSTRAINT "TrainingEffectiveness_enrolmentId_fkey" FOREIGN KEY ("enrolmentId") REFERENCES "TrainingEnrolment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

