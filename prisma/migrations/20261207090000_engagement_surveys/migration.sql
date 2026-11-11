-- CreateEnum
CREATE TYPE "SurveyStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "SurveyQuestionKind" AS ENUM ('SCALE', 'COMMENT');

-- CreateEnum
CREATE TYPE "SurveyCodeStatus" AS ENUM ('ACTIVE', 'USED', 'CANCELLED');

-- AlterTable
ALTER TABLE "HrPolicy" ADD COLUMN     "surveyRetentionMonths" INTEGER NOT NULL DEFAULT 24;

-- CreateTable
CREATE TABLE "Survey" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "intro" TEXT,
    "categoryId" TEXT,
    "departmentId" TEXT,
    "opensOn" DATE NOT NULL,
    "closesOn" DATE NOT NULL,
    "status" "SurveyStatus" NOT NULL DEFAULT 'DRAFT',
    "invitedCount" INTEGER NOT NULL DEFAULT 0,
    "closedAt" TIMESTAMP(3),
    "followUp" TEXT,
    "rawDeletedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Survey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SurveyQuestion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" "SurveyQuestionKind" NOT NULL,
    "text" TEXT NOT NULL,

    CONSTRAINT "SurveyQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SurveyAccessCode" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "categoryId" TEXT,
    "departmentId" TEXT,
    "codeHash" TEXT NOT NULL,
    "status" "SurveyCodeStatus" NOT NULL DEFAULT 'ACTIVE',
    "usedOn" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SurveyAccessCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SurveyResponse" (
    "id" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "categoryId" TEXT,
    "departmentId" TEXT,

    CONSTRAINT "SurveyResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SurveyAnswer" (
    "id" TEXT NOT NULL,
    "responseId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "value" INTEGER,
    "comment" TEXT,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "hiddenReason" TEXT,

    CONSTRAINT "SurveyAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SurveyKioskSession" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "deviceLabel" TEXT NOT NULL,
    "startedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SurveyKioskSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SurveyAggregate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "summary" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SurveyAggregate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Survey_organizationId_status_idx" ON "Survey"("organizationId", "status");

-- CreateIndex
CREATE INDEX "SurveyQuestion_surveyId_position_idx" ON "SurveyQuestion"("surveyId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "SurveyAccessCode_codeHash_key" ON "SurveyAccessCode"("codeHash");

-- CreateIndex
CREATE INDEX "SurveyAccessCode_surveyId_status_idx" ON "SurveyAccessCode"("surveyId", "status");

-- CreateIndex
CREATE INDEX "SurveyAccessCode_surveyId_employeeId_idx" ON "SurveyAccessCode"("surveyId", "employeeId");

-- CreateIndex
CREATE INDEX "SurveyResponse_surveyId_idx" ON "SurveyResponse"("surveyId");

-- CreateIndex
CREATE INDEX "SurveyAnswer_questionId_idx" ON "SurveyAnswer"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "SurveyAggregate_surveyId_key" ON "SurveyAggregate"("surveyId");

-- AddForeignKey
ALTER TABLE "Survey" ADD CONSTRAINT "Survey_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyQuestion" ADD CONSTRAINT "SurveyQuestion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyQuestion" ADD CONSTRAINT "SurveyQuestion_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "Survey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyAccessCode" ADD CONSTRAINT "SurveyAccessCode_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyAccessCode" ADD CONSTRAINT "SurveyAccessCode_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "Survey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyAccessCode" ADD CONSTRAINT "SurveyAccessCode_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyAnswer" ADD CONSTRAINT "SurveyAnswer_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "SurveyResponse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyAnswer" ADD CONSTRAINT "SurveyAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "SurveyQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyKioskSession" ADD CONSTRAINT "SurveyKioskSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyKioskSession" ADD CONSTRAINT "SurveyKioskSession_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "Survey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyAggregate" ADD CONSTRAINT "SurveyAggregate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyAggregate" ADD CONSTRAINT "SurveyAggregate_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "Survey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

