-- CreateEnum
CREATE TYPE "ErasureKind" AS ENUM ('RETENTION', 'REQUEST');

-- CreateEnum
CREATE TYPE "ErasureStatus" AS ENUM ('PENDING', 'EXECUTED', 'REJECTED');

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "anonymizedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "HrPolicy" ADD COLUMN     "employeeRetentionYears" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "EmployeeErasure" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "kind" "ErasureKind" NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ErasureStatus" NOT NULL DEFAULT 'PENDING',
    "requestedBy" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "decidedBy" TEXT,
    "decidedByUserId" TEXT,
    "decisionNote" TEXT,
    "decidedAt" TIMESTAMP(3),
    "summary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeErasure_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmployeeErasure_organizationId_status_idx" ON "EmployeeErasure"("organizationId", "status");

-- CreateIndex
CREATE INDEX "EmployeeErasure_employeeId_idx" ON "EmployeeErasure"("employeeId");

-- AddForeignKey
ALTER TABLE "EmployeeErasure" ADD CONSTRAINT "EmployeeErasure_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeErasure" ADD CONSTRAINT "EmployeeErasure_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

