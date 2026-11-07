-- Electronic employee documents, part C: the central register and the missing-document tracking (the founder, 2026-11-07; plan: docs/plans/employee-documents.md).
-- One new table: the document types the company requires, of everyone or of one employee category. Nothing existing changes and nothing is seeded:
-- the company sets its own requirements.

-- CreateTable
CREATE TABLE "EmployeeDocumentRequirement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "categoryId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeDocumentRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmployeeDocumentRequirement_organizationId_active_idx" ON "EmployeeDocumentRequirement"("organizationId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeDocumentRequirement_organizationId_typeId_categoryI_key" ON "EmployeeDocumentRequirement"("organizationId", "typeId", "categoryId");

-- AddForeignKey
ALTER TABLE "EmployeeDocumentRequirement" ADD CONSTRAINT "EmployeeDocumentRequirement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeDocumentRequirement" ADD CONSTRAINT "EmployeeDocumentRequirement_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "EmployeeDocumentType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeDocumentRequirement" ADD CONSTRAINT "EmployeeDocumentRequirement_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "EmployeeCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

