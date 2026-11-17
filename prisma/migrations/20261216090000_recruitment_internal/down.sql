-- Reverses 20261216090000_recruitment_internal. Drops the internal-applicant link and the three vacancy columns.
-- Internal applications keep their candidate rows (name, stage) but lose the link to the employee who applied, and vacancy publications (deadline, summary) are lost.
-- Take a backup first if internal vacancies have been used.

ALTER TABLE "Candidate" DROP CONSTRAINT "Candidate_applicantEmployeeId_fkey";
DROP INDEX "Candidate_requisitionId_applicantEmployeeId_key";
ALTER TABLE "Candidate" DROP COLUMN "applicantEmployeeId";

ALTER TABLE "JobRequisition" DROP COLUMN "applicationDeadline",
DROP COLUMN "publishedAt",
DROP COLUMN "vacancySummary";
