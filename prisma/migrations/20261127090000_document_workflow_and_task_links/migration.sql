-- Electronic employee documents, part B: the approval workflow and the onboarding and exit links (the founder, 2026-11-07; plan: docs/plans/employee-documents.md).
-- Additive only: review columns on EmployeeDocument, and a nullable document type and document on checklist template items, onboarding tasks and exit tasks.
-- Nothing existing changes: every existing task has no document link and is completed by hand exactly as before.

-- AlterTable
ALTER TABLE "ChecklistTemplateItem" ADD COLUMN     "documentTypeId" TEXT;

-- AlterTable
ALTER TABLE "EmployeeDocument" ADD COLUMN     "reviewNote" TEXT,
ADD COLUMN     "reviewStartedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedBy" TEXT,
ADD COLUMN     "reviewedByUserId" TEXT,
ADD COLUMN     "submittedAt" TIMESTAMP(3),
ADD COLUMN     "submittedBy" TEXT,
ADD COLUMN     "submittedByUserId" TEXT;

-- AlterTable
ALTER TABLE "ExitTask" ADD COLUMN     "documentId" TEXT,
ADD COLUMN     "documentTypeId" TEXT;

-- AlterTable
ALTER TABLE "OnboardingTask" ADD COLUMN     "documentId" TEXT,
ADD COLUMN     "documentTypeId" TEXT;

-- AddForeignKey
ALTER TABLE "OnboardingTask" ADD CONSTRAINT "OnboardingTask_documentTypeId_fkey" FOREIGN KEY ("documentTypeId") REFERENCES "EmployeeDocumentType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingTask" ADD CONSTRAINT "OnboardingTask_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "EmployeeDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExitTask" ADD CONSTRAINT "ExitTask_documentTypeId_fkey" FOREIGN KEY ("documentTypeId") REFERENCES "EmployeeDocumentType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExitTask" ADD CONSTRAINT "ExitTask_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "EmployeeDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistTemplateItem" ADD CONSTRAINT "ChecklistTemplateItem_documentTypeId_fkey" FOREIGN KEY ("documentTypeId") REFERENCES "EmployeeDocumentType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

