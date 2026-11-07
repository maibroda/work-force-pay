-- Electronic employee documents (the founder, 2026-11-07; plan: docs/plans/employee-documents.md), part A: the document store.
-- Two enums, three new tables (document types, versions, and the encrypted file bytes) and additive columns on EmployeeDocument.
-- Nothing existing changes: every existing document row keeps its values, has no type and no status, and shows as a reference-only record.

-- CreateEnum
CREATE TYPE "DocumentCategory" AS ENUM ('EMPLOYMENT', 'IDENTIFICATION', 'EDUCATION_PROFESSIONAL', 'COMPLIANCE', 'MEDICAL', 'STATUTORY', 'EXIT');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'EXPIRED', 'ARCHIVED');

-- AlterTable
ALTER TABLE "EmployeeDocument" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "archivedBy" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "status" "DocumentStatus",
ADD COLUMN     "typeId" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "EmployeeDocumentType" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "category" "DocumentCategory" NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT true,
    "hasExpiry" BOOLEAN NOT NULL DEFAULT false,
    "sensitive" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "standard" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeDocumentType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeDocumentVersion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "uploadedByUserId" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "replacedBy" TEXT,
    "replacedAt" TIMESTAMP(3),

    CONSTRAINT "EmployeeDocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeDocumentBlob" (
    "versionId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "iv" BYTEA NOT NULL,
    "authTag" BYTEA NOT NULL,
    "keyId" TEXT NOT NULL DEFAULT 'v1',

    CONSTRAINT "EmployeeDocumentBlob_pkey" PRIMARY KEY ("versionId")
);

-- CreateIndex
CREATE INDEX "EmployeeDocumentType_organizationId_category_idx" ON "EmployeeDocumentType"("organizationId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeDocumentType_organizationId_code_key" ON "EmployeeDocumentType"("organizationId", "code");

-- CreateIndex
CREATE INDEX "EmployeeDocumentVersion_organizationId_idx" ON "EmployeeDocumentVersion"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeDocumentVersion_documentId_version_key" ON "EmployeeDocumentVersion"("documentId", "version");

-- CreateIndex
CREATE INDEX "EmployeeDocumentBlob_organizationId_idx" ON "EmployeeDocumentBlob"("organizationId");

-- CreateIndex
CREATE INDEX "EmployeeDocument_organizationId_typeId_idx" ON "EmployeeDocument"("organizationId", "typeId");

-- AddForeignKey
ALTER TABLE "EmployeeDocument" ADD CONSTRAINT "EmployeeDocument_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "EmployeeDocumentType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeDocumentType" ADD CONSTRAINT "EmployeeDocumentType_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeDocumentVersion" ADD CONSTRAINT "EmployeeDocumentVersion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeDocumentVersion" ADD CONSTRAINT "EmployeeDocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "EmployeeDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeDocumentBlob" ADD CONSTRAINT "EmployeeDocumentBlob_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "EmployeeDocumentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeDocumentBlob" ADD CONSTRAINT "EmployeeDocumentBlob_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

