
-- CreateEnum
CREATE TYPE "FixedAssetCategory" AS ENUM ('VEHICLE', 'RADIO_COMMS', 'CCTV_SECURITY', 'FIREARM', 'OFFICE_EQUIPMENT', 'IT_EQUIPMENT', 'FURNITURE', 'OTHER');

-- CreateEnum
CREATE TYPE "FixedAssetStatus" AS ENUM ('ACTIVE', 'DISPOSED');

-- CreateTable
CREATE TABLE "FixedAsset" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "assetNumber" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "FixedAssetCategory" NOT NULL,
    "costCenterId" TEXT,
    "serialNumber" TEXT,
    "locationDescription" TEXT,
    "assignedToEmployeeId" TEXT,
    "acquisitionDate" DATE NOT NULL,
    "cost" DECIMAL(16,2) NOT NULL,
    "usefulLifeMonths" INTEGER NOT NULL,
    "salvageValue" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "status" "FixedAssetStatus" NOT NULL DEFAULT 'ACTIVE',
    "disposalDate" DATE,
    "disposalProceeds" DECIMAL(16,2),
    "disposalReason" TEXT,
    "notes" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FixedAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FixedAsset_organizationId_category_idx" ON "FixedAsset"("organizationId", "category");

-- CreateIndex
CREATE INDEX "FixedAsset_organizationId_status_idx" ON "FixedAsset"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "FixedAsset_organizationId_assetNumber_key" ON "FixedAsset"("organizationId", "assetNumber");

-- AddForeignKey
ALTER TABLE "FixedAsset" ADD CONSTRAINT "FixedAsset_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixedAsset" ADD CONSTRAINT "FixedAsset_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixedAsset" ADD CONSTRAINT "FixedAsset_assignedToEmployeeId_fkey" FOREIGN KEY ("assignedToEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

