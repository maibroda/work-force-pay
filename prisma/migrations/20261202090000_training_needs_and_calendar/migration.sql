-- Learning and development, step 1: training needs and a training calendar (the founder, 2026-11-10; plan: docs/plans/learning-development-plan.md).
-- Additive only: five enums, four new tables (programmes, sessions, enrolments, needs) and one nullable column on EmployeeTraining that says which enrolment created a
-- certificate record (null for every existing record). Nothing existing changes meaning and no existing row is rewritten.

-- CreateEnum
CREATE TYPE "TrainingSessionStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TrainingAttendance" AS ENUM ('ENROLLED', 'ATTENDED', 'ABSENT');

-- CreateEnum
CREATE TYPE "TrainingNeedSource" AS ENUM ('COMPLIANCE', 'APPRAISAL', 'REQUEST', 'OTHER');

-- CreateEnum
CREATE TYPE "TrainingNeedStatus" AS ENUM ('OPEN', 'PLANNED', 'MET', 'DROPPED');

-- CreateEnum
CREATE TYPE "TrainingPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH');

-- AlterTable
ALTER TABLE "EmployeeTraining" ADD COLUMN     "enrolmentId" TEXT;

-- CreateTable
CREATE TABLE "TrainingProgramme" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT,
    "validityMonths" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainingProgramme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingSession" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "programmeId" TEXT NOT NULL,
    "sessionDate" DATE NOT NULL,
    "startTime" TEXT,
    "venue" TEXT,
    "trainer" TEXT,
    "seats" INTEGER NOT NULL,
    "status" "TrainingSessionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledReason" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainingSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingEnrolment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "status" "TrainingAttendance" NOT NULL DEFAULT 'ENROLLED',
    "absenceReason" TEXT,
    "enrolledBy" TEXT NOT NULL,
    "markedBy" TEXT,
    "markedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainingEnrolment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingNeed" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "courseName" TEXT NOT NULL,
    "source" "TrainingNeedSource" NOT NULL,
    "note" TEXT,
    "priority" "TrainingPriority" NOT NULL DEFAULT 'NORMAL',
    "dueBy" DATE,
    "status" "TrainingNeedStatus" NOT NULL DEFAULT 'OPEN',
    "appraisalId" TEXT,
    "droppedReason" TEXT,
    "metAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainingNeed_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrainingProgramme_organizationId_active_idx" ON "TrainingProgramme"("organizationId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingProgramme_organizationId_name_key" ON "TrainingProgramme"("organizationId", "name");

-- CreateIndex
CREATE INDEX "TrainingSession_organizationId_sessionDate_idx" ON "TrainingSession"("organizationId", "sessionDate");

-- CreateIndex
CREATE INDEX "TrainingSession_programmeId_idx" ON "TrainingSession"("programmeId");

-- CreateIndex
CREATE INDEX "TrainingEnrolment_organizationId_employeeId_idx" ON "TrainingEnrolment"("organizationId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingEnrolment_sessionId_employeeId_key" ON "TrainingEnrolment"("sessionId", "employeeId");

-- CreateIndex
CREATE INDEX "TrainingNeed_organizationId_status_idx" ON "TrainingNeed"("organizationId", "status");

-- CreateIndex
CREATE INDEX "TrainingNeed_organizationId_employeeId_idx" ON "TrainingNeed"("organizationId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeTraining_enrolmentId_key" ON "EmployeeTraining"("enrolmentId");

-- AddForeignKey
ALTER TABLE "EmployeeTraining" ADD CONSTRAINT "EmployeeTraining_enrolmentId_fkey" FOREIGN KEY ("enrolmentId") REFERENCES "TrainingEnrolment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingProgramme" ADD CONSTRAINT "TrainingProgramme_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingSession" ADD CONSTRAINT "TrainingSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingSession" ADD CONSTRAINT "TrainingSession_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "TrainingProgramme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingEnrolment" ADD CONSTRAINT "TrainingEnrolment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingEnrolment" ADD CONSTRAINT "TrainingEnrolment_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TrainingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingEnrolment" ADD CONSTRAINT "TrainingEnrolment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingNeed" ADD CONSTRAINT "TrainingNeed_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingNeed" ADD CONSTRAINT "TrainingNeed_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

