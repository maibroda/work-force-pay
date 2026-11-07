-- Reverses migration.sql. THE APPROVAL HISTORY ON DOCUMENTS (WHO SUBMITTED, WHO REVIEWED, WHEN, AND THE REJECTION REASON OR NOTE) AND EVERY CHECKLIST STEP'S LINK TO A DOCUMENT TYPE
-- AND TO ITS DOCUMENT ARE LOST. Tasks already completed by an approved document stay completed (their status is not touched), but would afterwards be ticked by hand.
-- The uploaded files, their versions and the document types are NOT touched (they belong to migration 20261126090000). Take a backup of these columns first if they have been used for real.
ALTER TABLE "ChecklistTemplateItem" DROP CONSTRAINT "ChecklistTemplateItem_documentTypeId_fkey";
ALTER TABLE "ExitTask" DROP CONSTRAINT "ExitTask_documentId_fkey";
ALTER TABLE "ExitTask" DROP CONSTRAINT "ExitTask_documentTypeId_fkey";
ALTER TABLE "OnboardingTask" DROP CONSTRAINT "OnboardingTask_documentId_fkey";
ALTER TABLE "OnboardingTask" DROP CONSTRAINT "OnboardingTask_documentTypeId_fkey";
ALTER TABLE "OnboardingTask" DROP COLUMN "documentId", DROP COLUMN "documentTypeId";
ALTER TABLE "ExitTask" DROP COLUMN "documentId", DROP COLUMN "documentTypeId";
ALTER TABLE "EmployeeDocument" DROP COLUMN "reviewNote", DROP COLUMN "reviewStartedAt", DROP COLUMN "reviewedAt", DROP COLUMN "reviewedBy", DROP COLUMN "reviewedByUserId", DROP COLUMN "submittedAt", DROP COLUMN "submittedBy", DROP COLUMN "submittedByUserId";
ALTER TABLE "ChecklistTemplateItem" DROP COLUMN "documentTypeId";
