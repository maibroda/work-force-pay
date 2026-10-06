-- CreateEnum
CREATE TYPE "BreachStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "BreachAssessment" AS ENUM ('UNASSESSED', 'NO_RISK', 'RISK', 'HIGH_RISK');

-- AlterTable
ALTER TABLE "HrPolicy" ADD COLUMN     "breachNotifyHours" INTEGER NOT NULL DEFAULT 72,
ADD COLUMN     "twoFactorEnforceFrom" DATE,
ADD COLUMN     "twoFactorRoles" "Role"[] DEFAULT ARRAY[]::"Role"[];

-- CreateTable
CREATE TABLE "DataBreach" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "incidentNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "discoveredAt" TIMESTAMP(3) NOT NULL,
    "occurredOn" DATE,
    "dataCategories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "individualsAffected" INTEGER,
    "status" "BreachStatus" NOT NULL DEFAULT 'OPEN',
    "assessment" "BreachAssessment" NOT NULL DEFAULT 'UNASSESSED',
    "assessmentNote" TEXT,
    "assessedBy" TEXT,
    "assessedAt" TIMESTAMP(3),
    "containedAt" TIMESTAMP(3),
    "containmentNote" TEXT,
    "rootCause" TEXT,
    "remediation" TEXT,
    "ndpcNotifiedAt" TIMESTAMP(3),
    "ndpcReference" TEXT,
    "lateReason" TEXT,
    "individualsNotifiedAt" TIMESTAMP(3),
    "individualsNote" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedBy" TEXT,
    "reportedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataBreach_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataBreachUpdate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "breachId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataBreachUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DataBreach_organizationId_status_idx" ON "DataBreach"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DataBreach_organizationId_incidentNumber_key" ON "DataBreach"("organizationId", "incidentNumber");

-- CreateIndex
CREATE INDEX "DataBreachUpdate_breachId_idx" ON "DataBreachUpdate"("breachId");

-- AddForeignKey
ALTER TABLE "DataBreach" ADD CONSTRAINT "DataBreach_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataBreachUpdate" ADD CONSTRAINT "DataBreachUpdate_breachId_fkey" FOREIGN KEY ("breachId") REFERENCES "DataBreach"("id") ON DELETE CASCADE ON UPDATE CASCADE;

