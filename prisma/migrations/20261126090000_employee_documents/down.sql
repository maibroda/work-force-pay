-- Reverses migration.sql. EVERY UPLOADED DOCUMENT FILE, ITS VERSIONS, THE COMPANY'S DOCUMENT TYPES, AND THE TYPE, STATUS, DESCRIPTION AND ARCHIVE FIELDS ON DOCUMENT RECORDS ARE LOST.
-- Once files have been uploaded for real, take a backup of these tables (and keep DOCUMENT_ENCRYPTION_KEY) before running this. The old reference-only fields of every document row are untouched.
DROP TABLE "EmployeeDocumentBlob";
DROP TABLE "EmployeeDocumentVersion";
ALTER TABLE "EmployeeDocument" DROP CONSTRAINT "EmployeeDocument_typeId_fkey";
ALTER TABLE "EmployeeDocument" DROP COLUMN "archivedAt", DROP COLUMN "archivedBy", DROP COLUMN "description", DROP COLUMN "status", DROP COLUMN "typeId", DROP COLUMN "updatedAt";
DROP TABLE "EmployeeDocumentType";
DROP TYPE "DocumentStatus";
DROP TYPE "DocumentCategory";
