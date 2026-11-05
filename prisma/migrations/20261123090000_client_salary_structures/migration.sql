-- A salary structure for each client, with role sub-structures (the founder, 2026-11-05; docs/plans/client-salary-structures.md).
-- Three optional columns on SalaryStructure: the client that owns it, the structure it sits under, and the job category a role structure is for.
-- Every existing structure keeps all three empty (company-wide), so nothing existing changes or is lost.

-- AlterTable
ALTER TABLE "SalaryStructure" ADD COLUMN "clientId" TEXT,
ADD COLUMN "parentId" TEXT,
ADD COLUMN "categoryId" TEXT;

-- CreateIndex
CREATE INDEX "SalaryStructure_organizationId_clientId_idx" ON "SalaryStructure"("organizationId", "clientId");

-- CreateIndex
CREATE INDEX "SalaryStructure_parentId_categoryId_idx" ON "SalaryStructure"("parentId", "categoryId");

-- AddForeignKey
ALTER TABLE "SalaryStructure" ADD CONSTRAINT "SalaryStructure_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryStructure" ADD CONSTRAINT "SalaryStructure_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "SalaryStructure"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryStructure" ADD CONSTRAINT "SalaryStructure_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "EmployeeCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
