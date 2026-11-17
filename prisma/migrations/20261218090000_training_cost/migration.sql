-- CreateEnum
CREATE TYPE "TrainingCostKind" AS ENUM ('FEE', 'TRAVEL', 'MATERIALS', 'VENUE', 'OTHER');

-- CreateEnum
CREATE TYPE "TrainingCostStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "HrPolicy" ADD COLUMN     "trainingCostApprovalThreshold" DECIMAL(16,2);

-- CreateTable
CREATE TABLE "TrainingCostLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "kind" "TrainingCostKind" NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "description" TEXT NOT NULL,
    "invoiceReference" TEXT,
    "reversesId" TEXT,
    "status" "TrainingCostStatus" NOT NULL DEFAULT 'APPROVED',
    "recordedById" TEXT NOT NULL,
    "recordedBy" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" TEXT,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,

    CONSTRAINT "TrainingCostLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingBudget" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "departmentId" TEXT,
    "amount" DECIMAL(16,2) NOT NULL,
    "setBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingBudget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrainingCostLine_reversesId_key" ON "TrainingCostLine"("reversesId");

-- CreateIndex
CREATE INDEX "TrainingCostLine_organizationId_sessionId_idx" ON "TrainingCostLine"("organizationId", "sessionId");

-- CreateIndex
CREATE INDEX "TrainingCostLine_organizationId_status_idx" ON "TrainingCostLine"("organizationId", "status");

-- CreateIndex
CREATE INDEX "TrainingBudget_organizationId_year_idx" ON "TrainingBudget"("organizationId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingBudget_organizationId_year_departmentId_key" ON "TrainingBudget"("organizationId", "year", "departmentId");

-- AddForeignKey
ALTER TABLE "TrainingCostLine" ADD CONSTRAINT "TrainingCostLine_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingCostLine" ADD CONSTRAINT "TrainingCostLine_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TrainingSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingCostLine" ADD CONSTRAINT "TrainingCostLine_reversesId_fkey" FOREIGN KEY ("reversesId") REFERENCES "TrainingCostLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingBudget" ADD CONSTRAINT "TrainingBudget_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingBudget" ADD CONSTRAINT "TrainingBudget_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

