-- AlterTable
ALTER TABLE "Beat" ADD COLUMN     "costCenterId" TEXT;

-- AlterTable
ALTER TABLE "Contract" ADD COLUMN     "costCenterId" TEXT;

-- AlterTable
ALTER TABLE "Department" ADD COLUMN     "costCenterId" TEXT;

-- DropEnum
DROP TYPE "CostCenterOwnerType";

-- CreateTable
CREATE TABLE "CostCenter" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CostCenter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostCenterBudget" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "costCenterId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "budgetedAmount" DECIMAL(16,2) NOT NULL,
    "notes" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CostCenterBudget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CostCenter_organizationId_code_key" ON "CostCenter"("organizationId", "code");

-- CreateIndex
CREATE INDEX "CostCenterBudget_organizationId_year_month_idx" ON "CostCenterBudget"("organizationId", "year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "CostCenterBudget_costCenterId_year_month_key" ON "CostCenterBudget"("costCenterId", "year", "month");

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostCenter" ADD CONSTRAINT "CostCenter_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostCenterBudget" ADD CONSTRAINT "CostCenterBudget_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostCenterBudget" ADD CONSTRAINT "CostCenterBudget_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Beat" ADD CONSTRAINT "Beat_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;
