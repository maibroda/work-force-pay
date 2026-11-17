-- AlterTable
ALTER TABLE "Candidate" ADD COLUMN     "applicantEmployeeId" TEXT;

-- AlterTable
ALTER TABLE "JobRequisition" ADD COLUMN     "applicationDeadline" DATE,
ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "vacancySummary" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Candidate_requisitionId_applicantEmployeeId_key" ON "Candidate"("requisitionId", "applicantEmployeeId");

-- AddForeignKey
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_applicantEmployeeId_fkey" FOREIGN KEY ("applicantEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

