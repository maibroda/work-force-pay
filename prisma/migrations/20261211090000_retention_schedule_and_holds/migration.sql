-- CreateEnum
CREATE TYPE "RetentionCategory" AS ENUM ('EMPLOYEE_FILE', 'APPRAISALS', 'PROBATION', 'FEEDBACK', 'IMPROVEMENT_PLANS', 'DISCIPLINARY', 'TRAINING', 'SKILLS', 'WELFARE_CASES', 'SUCCESSION', 'RAW_SURVEYS', 'SURVEY_REPORTS', 'AUDIT_LOGS', 'UNSUCCESSFUL_APPLICANTS', 'ACCESS_LOGS');

-- CreateEnum
CREATE TYPE "RetentionTrigger" AS ENUM ('AFTER_EXIT', 'AFTER_CLOSURE', 'AFTER_RECORD_DATE', 'AFTER_SURVEY_CLOSE', 'AFTER_RECRUITMENT_CLOSE', 'AFTER_ACCOUNT_CLOSURE');

-- CreateEnum
CREATE TYPE "RetentionAction" AS ENUM ('DELETE', 'ANONYMISE', 'REVIEW', 'KEEP');

-- CreateEnum
CREATE TYPE "RetentionHoldScope" AS ENUM ('EMPLOYEE', 'CATEGORY', 'COMPANY');

-- CreateTable
CREATE TABLE "RetentionRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "category" "RetentionCategory" NOT NULL,
    "periodMonths" INTEGER NOT NULL,
    "trigger" "RetentionTrigger" NOT NULL,
    "action" "RetentionAction" NOT NULL,
    "note" TEXT,
    "verifiedOn" DATE,
    "verifiedBy" TEXT,
    "verifiedNote" TEXT,
    "updatedByUserId" TEXT,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RetentionRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetentionHold" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "scope" "RetentionHoldScope" NOT NULL,
    "employeeId" TEXT,
    "category" "RetentionCategory",
    "reason" TEXT NOT NULL,
    "reviewOn" DATE NOT NULL,
    "placedByUserId" TEXT NOT NULL,
    "placedBy" TEXT NOT NULL,
    "placedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),
    "releasedByUserId" TEXT,
    "releasedBy" TEXT,
    "releaseReason" TEXT,

    CONSTRAINT "RetentionHold_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RetentionRule_organizationId_category_key" ON "RetentionRule"("organizationId", "category");

-- CreateIndex
CREATE INDEX "RetentionHold_organizationId_releasedAt_idx" ON "RetentionHold"("organizationId", "releasedAt");

-- AddForeignKey
ALTER TABLE "RetentionRule" ADD CONSTRAINT "RetentionRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetentionHold" ADD CONSTRAINT "RetentionHold_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetentionHold" ADD CONSTRAINT "RetentionHold_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

