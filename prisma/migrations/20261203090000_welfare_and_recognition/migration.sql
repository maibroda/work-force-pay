-- Welfare and recognition, step 1: welfare support requests and recognition awards (the founder, 2026-11-10; plan: docs/plans/welfare-recognition-plan.md).
-- Additive only: a WELFARE value on the case type, a nullable welfare kind on cases, two enums, two new tables (award types and awards) and the company's long-service years on
-- the HR policy (default 5, 10, 15, 20). Nothing existing changes meaning and no existing row is rewritten.

-- CreateEnum
CREATE TYPE "WelfareKind" AS ENUM ('BEREAVEMENT', 'FINANCIAL_HARDSHIP', 'HEALTH_WELLBEING', 'FAMILY', 'HOUSING_TRANSPORT', 'OTHER');

-- CreateEnum
CREATE TYPE "RecognitionStatus" AS ENUM ('NOMINATED', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- AlterEnum
ALTER TYPE "RelationsCaseType" ADD VALUE 'WELFARE';

-- AlterTable
ALTER TABLE "HrPolicy" ADD COLUMN     "longServiceYears" INTEGER[] DEFAULT ARRAY[5, 10, 15, 20]::INTEGER[];

-- AlterTable
ALTER TABLE "RelationsCase" ADD COLUMN     "welfareKind" "WelfareKind";

-- CreateTable
CREATE TABLE "RecognitionAwardType" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "longServiceYears" INTEGER,
    "mayAnnounce" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecognitionAwardType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecognitionAward" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "citation" TEXT NOT NULL,
    "status" "RecognitionStatus" NOT NULL DEFAULT 'NOMINATED',
    "nominatedByUserId" TEXT NOT NULL,
    "nominatedBy" TEXT NOT NULL,
    "nominatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedByUserId" TEXT,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "awardedOn" DATE,
    "withdrawnByUserId" TEXT,
    "withdrawnBy" TEXT,
    "withdrawnAt" TIMESTAMP(3),
    "withdrawReason" TEXT,
    "announceAgreed" BOOLEAN,
    "announceAnsweredAt" TIMESTAMP(3),

    CONSTRAINT "RecognitionAward_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecognitionAwardType_organizationId_active_idx" ON "RecognitionAwardType"("organizationId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "RecognitionAwardType_organizationId_name_key" ON "RecognitionAwardType"("organizationId", "name");

-- CreateIndex
CREATE INDEX "RecognitionAward_organizationId_status_idx" ON "RecognitionAward"("organizationId", "status");

-- CreateIndex
CREATE INDEX "RecognitionAward_organizationId_employeeId_idx" ON "RecognitionAward"("organizationId", "employeeId");

-- AddForeignKey
ALTER TABLE "RecognitionAwardType" ADD CONSTRAINT "RecognitionAwardType_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecognitionAward" ADD CONSTRAINT "RecognitionAward_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecognitionAward" ADD CONSTRAINT "RecognitionAward_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecognitionAward" ADD CONSTRAINT "RecognitionAward_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "RecognitionAwardType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

