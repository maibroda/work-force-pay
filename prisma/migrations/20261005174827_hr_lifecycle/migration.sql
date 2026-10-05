-- CreateEnum
CREATE TYPE "ExitReasonCategory" AS ENUM ('BETTER_PAY', 'CAREER_GROWTH', 'RELOCATION', 'PERSONAL_OR_HEALTH', 'WORK_CONDITIONS', 'MANAGER_RELATIONSHIP', 'PERFORMANCE', 'MISCONDUCT', 'REDUNDANCY', 'CONTRACT_END', 'RETIREMENT', 'DEATH', 'OTHER');

-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('PERMANENT', 'FIXED_TERM', 'PROBATION', 'CASUAL', 'CONSULTANT', 'INTERNSHIP');

-- CreateEnum
CREATE TYPE "EmploymentContractStatus" AS ENUM ('ACTIVE', 'SUPERSEDED', 'TERMINATED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ProbationOutcome" AS ENUM ('PENDING', 'CONFIRMED', 'EXTENDED', 'FAILED');

-- CreateEnum
CREATE TYPE "ChecklistKind" AS ENUM ('ONBOARDING', 'EXIT_CLEARANCE');

-- CreateEnum
CREATE TYPE "RequisitionStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'ON_HOLD', 'FILLED', 'CLOSED');

-- CreateEnum
CREATE TYPE "CandidateStage" AS ENUM ('APPLIED', 'SCREENING', 'INTERVIEW', 'ASSESSMENT', 'OFFER', 'HIRED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "CandidateSource" AS ENUM ('REFERRAL', 'JOB_BOARD', 'WALK_IN', 'AGENCY', 'INTERNAL', 'SOCIAL_MEDIA', 'OTHER');

-- CreateEnum
CREATE TYPE "InterviewRecommendation" AS ENUM ('STRONG_HIRE', 'HIRE', 'NO_HIRE', 'STRONG_NO_HIRE');

-- CreateEnum
CREATE TYPE "CandidateCheckType" AS ENUM ('REFERENCE', 'ID_VERIFICATION', 'POLICE_CLEARANCE', 'GUARANTOR', 'MEDICAL', 'EDUCATION', 'CREDIT', 'OTHER');

-- CreateEnum
CREATE TYPE "CheckStatus" AS ENUM ('PENDING', 'CLEARED', 'FAILED', 'WAIVED');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'WITHDRAWN', 'REJECTED');

-- CreateEnum
CREATE TYPE "RelationsCaseType" AS ENUM ('GRIEVANCE', 'MISCONDUCT', 'HARASSMENT', 'WHISTLEBLOWING', 'COUNSELLING', 'MEDIATION', 'OTHER');

-- CreateEnum
CREATE TYPE "CaseSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "CaseStatus" AS ENUM ('OPEN', 'INVESTIGATING', 'HEARING', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "CaseOutcome" AS ENUM ('SUBSTANTIATED', 'PARTIALLY_SUBSTANTIATED', 'UNSUBSTANTIATED', 'RESOLVED_INFORMALLY', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "CaseNoteKind" AS ENUM ('NOTE', 'INVESTIGATION', 'HEARING', 'EVIDENCE', 'DECISION', 'APPEAL');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'RELEASED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SettlementLineKind" AS ENUM ('EARNING', 'DEDUCTION');

-- CreateEnum
CREATE TYPE "EosPayBasis" AS ENUM ('GROSS', 'BASIC');

-- AlterTable
ALTER TABLE "DisciplinaryRecord" ADD COLUMN     "caseId" TEXT;

-- AlterTable
ALTER TABLE "ExitRecord" ADD COLUMN     "eligibleForRehire" BOOLEAN,
ADD COLUMN     "exitInterviewBy" TEXT,
ADD COLUMN     "exitInterviewDate" DATE,
ADD COLUMN     "exitInterviewNotes" TEXT,
ADD COLUMN     "noticePeriodDays" INTEGER,
ADD COLUMN     "reasonCategory" "ExitReasonCategory",
ADD COLUMN     "summaryDismissal" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ExitTask" ADD COLUMN     "blocksSettlement" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "dueDate" DATE,
ADD COLUMN     "mandatory" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "responsibleRole" TEXT,
ADD COLUMN     "systemKey" TEXT;

-- AlterTable
ALTER TABLE "OnboardingTask" ADD COLUMN     "mandatory" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "responsibleRole" TEXT;

-- CreateTable
CREATE TABLE "HrPolicy" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "defaultProbationMonths" INTEGER NOT NULL DEFAULT 3,
    "maxProbationMonths" INTEGER NOT NULL DEFAULT 6,
    "defaultNoticeDays" INTEGER NOT NULL DEFAULT 30,
    "retirementAge" INTEGER NOT NULL DEFAULT 60,
    "contractAlertDays" INTEGER NOT NULL DEFAULT 60,
    "probationAlertDays" INTEGER NOT NULL DEFAULT 30,
    "offerValidityDays" INTEGER NOT NULL DEFAULT 14,
    "relationsCaseSlaDays" INTEGER NOT NULL DEFAULT 21,
    "dailyRateDivisor" INTEGER NOT NULL DEFAULT 30,
    "leaveEncashmentEnabled" BOOLEAN NOT NULL DEFAULT true,
    "leaveEncashmentBasis" "EosPayBasis" NOT NULL DEFAULT 'GROSS',
    "leaveEncashmentRespectsEligibility" BOOLEAN NOT NULL DEFAULT true,
    "leaveEncashmentMaxDays" INTEGER,
    "leaveEncashmentTaxable" BOOLEAN NOT NULL DEFAULT true,
    "leaveEncashmentExitTypes" "ExitType"[] DEFAULT ARRAY['RESIGNATION', 'TERMINATION', 'END_OF_CONTRACT', 'RETIREMENT', 'DECEASED']::"ExitType"[],
    "gratuityEnabled" BOOLEAN NOT NULL DEFAULT false,
    "gratuityBasis" "EosPayBasis" NOT NULL DEFAULT 'BASIC',
    "gratuityMinYears" INTEGER NOT NULL DEFAULT 5,
    "gratuityDaysPerYear" DECIMAL(6,2) NOT NULL DEFAULT 15,
    "gratuityPartialYears" BOOLEAN NOT NULL DEFAULT false,
    "gratuityTaxable" BOOLEAN NOT NULL DEFAULT true,
    "gratuityExitTypes" "ExitType"[] DEFAULT ARRAY['RESIGNATION', 'END_OF_CONTRACT', 'RETIREMENT', 'DECEASED']::"ExitType"[],
    "severanceEnabled" BOOLEAN NOT NULL DEFAULT false,
    "severanceDaysPerYear" DECIMAL(6,2) NOT NULL DEFAULT 15,
    "severanceTaxable" BOOLEAN NOT NULL DEFAULT true,
    "noticePayEnabled" BOOLEAN NOT NULL DEFAULT true,
    "noticeRecoveryEnabled" BOOLEAN NOT NULL DEFAULT true,
    "noticePayTaxable" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistTemplateItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" "ChecklistKind" NOT NULL,
    "taskName" TEXT NOT NULL,
    "dueOffsetDays" INTEGER NOT NULL DEFAULT 0,
    "responsibleRole" TEXT,
    "mandatory" BOOLEAN NOT NULL DEFAULT true,
    "blocksSettlement" BOOLEAN NOT NULL DEFAULT true,
    "systemKey" TEXT,
    "categoryId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChecklistTemplateItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmploymentContract" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contractNumber" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "type" "EmploymentType" NOT NULL,
    "status" "EmploymentContractStatus" NOT NULL DEFAULT 'ACTIVE',
    "jobTitle" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "probationMonths" INTEGER NOT NULL DEFAULT 0,
    "probationEndDate" DATE,
    "probationOutcome" "ProbationOutcome",
    "probationExtensions" INTEGER NOT NULL DEFAULT 0,
    "noticePeriodDays" INTEGER NOT NULL DEFAULT 30,
    "signedDate" DATE,
    "documentReference" TEXT,
    "previousContractId" TEXT,
    "terminatedAt" DATE,
    "terminationReason" TEXT,
    "notes" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmploymentContract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobRequisition" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requisitionNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "departmentId" TEXT,
    "categoryId" TEXT NOT NULL,
    "costCenterId" TEXT,
    "beatId" TEXT,
    "hiringManagerId" TEXT,
    "headcount" INTEGER NOT NULL DEFAULT 1,
    "employmentType" "EmploymentType" NOT NULL DEFAULT 'PERMANENT',
    "budgetedMonthlyGross" DECIMAL(14,2),
    "justification" TEXT NOT NULL,
    "targetStartDate" DATE,
    "status" "RequisitionStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "requestedBy" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobRequisition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Candidate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "candidateNumber" TEXT NOT NULL,
    "requisitionId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "source" "CandidateSource" NOT NULL DEFAULT 'OTHER',
    "stage" "CandidateStage" NOT NULL DEFAULT 'APPLIED',
    "expectedMonthlyGross" DECIMAL(14,2),
    "resumeReference" TEXT,
    "notes" TEXT,
    "rejectionReason" TEXT,
    "stageChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "employeeId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Candidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Interview" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "round" INTEGER NOT NULL DEFAULT 1,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "mode" TEXT,
    "interviewer" TEXT NOT NULL,
    "score" INTEGER,
    "recommendation" "InterviewRecommendation",
    "feedback" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Interview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateCheck" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "checkType" "CandidateCheckType" NOT NULL,
    "status" "CheckStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "checkedBy" TEXT,
    "checkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CandidateCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobOffer" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "offerNumber" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "jobTitle" TEXT NOT NULL,
    "monthlyGross" DECIMAL(14,2) NOT NULL,
    "employmentType" "EmploymentType" NOT NULL DEFAULT 'PERMANENT',
    "probationMonths" INTEGER NOT NULL DEFAULT 0,
    "noticePeriodDays" INTEGER NOT NULL DEFAULT 30,
    "startDate" DATE NOT NULL,
    "validUntil" DATE NOT NULL,
    "setPayRate" BOOLEAN NOT NULL DEFAULT true,
    "status" "OfferStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "createdBy" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "declineReason" TEXT,
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RelationsCase" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "caseNumber" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "type" "RelationsCaseType" NOT NULL,
    "severity" "CaseSeverity" NOT NULL DEFAULT 'MEDIUM',
    "status" "CaseStatus" NOT NULL DEFAULT 'OPEN',
    "confidential" BOOLEAN NOT NULL DEFAULT false,
    "summary" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "raisedBy" TEXT NOT NULL,
    "raisedByUserId" TEXT NOT NULL,
    "selfRaised" BOOLEAN NOT NULL DEFAULT false,
    "assignedTo" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" DATE,
    "outcome" "CaseOutcome",
    "resolution" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RelationsCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RelationsCaseNote" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "kind" "CaseNoteKind" NOT NULL DEFAULT 'NOTE',
    "note" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RelationsCaseNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExitSettlement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "settlementNumber" TEXT NOT NULL,
    "exitRecordId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "status" "SettlementStatus" NOT NULL DEFAULT 'DRAFT',
    "monthlyGross" DECIMAL(14,2) NOT NULL,
    "monthlyBasic" DECIMAL(14,2) NOT NULL,
    "dailyRate" DECIMAL(14,2) NOT NULL,
    "payBasisSource" TEXT NOT NULL,
    "serviceDays" INTEGER NOT NULL,
    "serviceYears" DECIMAL(6,2) NOT NULL,
    "leaveAccruedDays" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "leaveTakenDays" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "leavePayableDays" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "noticeRequiredDays" INTEGER NOT NULL DEFAULT 0,
    "noticeServedDays" INTEGER NOT NULL DEFAULT 0,
    "noticeShortfallDays" INTEGER NOT NULL DEFAULT 0,
    "grossEarnings" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalDeductions" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "netSettlement" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "payrollPeriodId" TEXT,
    "preparedBy" TEXT NOT NULL,
    "preparedById" TEXT NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "releasedBy" TEXT,
    "releasedAt" TIMESTAMP(3),
    "remarks" TEXT,
    "calcTrace" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExitSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExitSettlementLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "kind" "SettlementLineKind" NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(8,2),
    "rate" DECIMAL(14,2),
    "amount" DECIMAL(14,2) NOT NULL,
    "taxable" BOOLEAN NOT NULL DEFAULT true,
    "manual" BOOLEAN NOT NULL DEFAULT false,
    "otherEarningId" TEXT,
    "deductionId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExitSettlementLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HrPolicy_organizationId_key" ON "HrPolicy"("organizationId");

-- CreateIndex
CREATE INDEX "ChecklistTemplateItem_organizationId_kind_active_idx" ON "ChecklistTemplateItem"("organizationId", "kind", "active");

-- CreateIndex
CREATE UNIQUE INDEX "ChecklistTemplateItem_organizationId_kind_taskName_key" ON "ChecklistTemplateItem"("organizationId", "kind", "taskName");

-- CreateIndex
CREATE INDEX "EmploymentContract_organizationId_employeeId_idx" ON "EmploymentContract"("organizationId", "employeeId");

-- CreateIndex
CREATE INDEX "EmploymentContract_organizationId_status_endDate_idx" ON "EmploymentContract"("organizationId", "status", "endDate");

-- CreateIndex
CREATE UNIQUE INDEX "EmploymentContract_organizationId_contractNumber_key" ON "EmploymentContract"("organizationId", "contractNumber");

-- CreateIndex
CREATE INDEX "JobRequisition_organizationId_status_idx" ON "JobRequisition"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "JobRequisition_organizationId_requisitionNumber_key" ON "JobRequisition"("organizationId", "requisitionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Candidate_employeeId_key" ON "Candidate"("employeeId");

-- CreateIndex
CREATE INDEX "Candidate_organizationId_requisitionId_stage_idx" ON "Candidate"("organizationId", "requisitionId", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "Candidate_organizationId_candidateNumber_key" ON "Candidate"("organizationId", "candidateNumber");

-- CreateIndex
CREATE INDEX "Interview_organizationId_candidateId_idx" ON "Interview"("organizationId", "candidateId");

-- CreateIndex
CREATE INDEX "CandidateCheck_organizationId_candidateId_idx" ON "CandidateCheck"("organizationId", "candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateCheck_candidateId_checkType_key" ON "CandidateCheck"("candidateId", "checkType");

-- CreateIndex
CREATE INDEX "JobOffer_organizationId_candidateId_idx" ON "JobOffer"("organizationId", "candidateId");

-- CreateIndex
CREATE INDEX "JobOffer_organizationId_status_idx" ON "JobOffer"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "JobOffer_organizationId_offerNumber_key" ON "JobOffer"("organizationId", "offerNumber");

-- CreateIndex
CREATE INDEX "RelationsCase_organizationId_status_idx" ON "RelationsCase"("organizationId", "status");

-- CreateIndex
CREATE INDEX "RelationsCase_organizationId_employeeId_idx" ON "RelationsCase"("organizationId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "RelationsCase_organizationId_caseNumber_key" ON "RelationsCase"("organizationId", "caseNumber");

-- CreateIndex
CREATE INDEX "RelationsCaseNote_organizationId_caseId_idx" ON "RelationsCaseNote"("organizationId", "caseId");

-- CreateIndex
CREATE UNIQUE INDEX "ExitSettlement_exitRecordId_key" ON "ExitSettlement"("exitRecordId");

-- CreateIndex
CREATE INDEX "ExitSettlement_organizationId_status_idx" ON "ExitSettlement"("organizationId", "status");

-- CreateIndex
CREATE INDEX "ExitSettlement_organizationId_employeeId_idx" ON "ExitSettlement"("organizationId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "ExitSettlement_organizationId_settlementNumber_key" ON "ExitSettlement"("organizationId", "settlementNumber");

-- CreateIndex
CREATE INDEX "ExitSettlementLine_organizationId_settlementId_idx" ON "ExitSettlementLine"("organizationId", "settlementId");

-- AddForeignKey
ALTER TABLE "DisciplinaryRecord" ADD CONSTRAINT "DisciplinaryRecord_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "RelationsCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrPolicy" ADD CONSTRAINT "HrPolicy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistTemplateItem" ADD CONSTRAINT "ChecklistTemplateItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistTemplateItem" ADD CONSTRAINT "ChecklistTemplateItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "EmployeeCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmploymentContract" ADD CONSTRAINT "EmploymentContract_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmploymentContract" ADD CONSTRAINT "EmploymentContract_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmploymentContract" ADD CONSTRAINT "EmploymentContract_previousContractId_fkey" FOREIGN KEY ("previousContractId") REFERENCES "EmploymentContract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobRequisition" ADD CONSTRAINT "JobRequisition_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobRequisition" ADD CONSTRAINT "JobRequisition_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobRequisition" ADD CONSTRAINT "JobRequisition_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "EmployeeCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobRequisition" ADD CONSTRAINT "JobRequisition_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobRequisition" ADD CONSTRAINT "JobRequisition_hiringManagerId_fkey" FOREIGN KEY ("hiringManagerId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_requisitionId_fkey" FOREIGN KEY ("requisitionId") REFERENCES "JobRequisition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateCheck" ADD CONSTRAINT "CandidateCheck_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateCheck" ADD CONSTRAINT "CandidateCheck_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobOffer" ADD CONSTRAINT "JobOffer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobOffer" ADD CONSTRAINT "JobOffer_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelationsCase" ADD CONSTRAINT "RelationsCase_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelationsCase" ADD CONSTRAINT "RelationsCase_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelationsCaseNote" ADD CONSTRAINT "RelationsCaseNote_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelationsCaseNote" ADD CONSTRAINT "RelationsCaseNote_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "RelationsCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExitSettlement" ADD CONSTRAINT "ExitSettlement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExitSettlement" ADD CONSTRAINT "ExitSettlement_exitRecordId_fkey" FOREIGN KEY ("exitRecordId") REFERENCES "ExitRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExitSettlement" ADD CONSTRAINT "ExitSettlement_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExitSettlement" ADD CONSTRAINT "ExitSettlement_payrollPeriodId_fkey" FOREIGN KEY ("payrollPeriodId") REFERENCES "PayrollPeriod"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExitSettlementLine" ADD CONSTRAINT "ExitSettlementLine_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExitSettlementLine" ADD CONSTRAINT "ExitSettlementLine_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "ExitSettlement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

