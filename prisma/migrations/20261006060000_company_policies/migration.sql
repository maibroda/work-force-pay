-- CreateEnum
CREATE TYPE "PolicyStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AckMethod" AS ENUM ('SELF', 'RECORDED');

-- CreateTable
CREATE TABLE "CompanyPolicy" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "categoryId" TEXT,
    "graceDays" INTEGER NOT NULL DEFAULT 14,
    "status" "PolicyStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyVersion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "body" TEXT,
    "documentReference" TEXT,
    "changeSummary" TEXT,
    "publishedBy" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyAcknowledgement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "acknowledgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "method" "AckMethod" NOT NULL DEFAULT 'SELF',
    "recordedBy" TEXT,
    "note" TEXT,

    CONSTRAINT "PolicyAcknowledgement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompanyPolicy_organizationId_status_idx" ON "CompanyPolicy"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyPolicy_organizationId_title_key" ON "CompanyPolicy"("organizationId", "title");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyVersion_policyId_version_key" ON "PolicyVersion"("policyId", "version");

-- CreateIndex
CREATE INDEX "PolicyAcknowledgement_organizationId_employeeId_idx" ON "PolicyAcknowledgement"("organizationId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyAcknowledgement_versionId_employeeId_key" ON "PolicyAcknowledgement"("versionId", "employeeId");

-- AddForeignKey
ALTER TABLE "CompanyPolicy" ADD CONSTRAINT "CompanyPolicy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyPolicy" ADD CONSTRAINT "CompanyPolicy_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "EmployeeCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyVersion" ADD CONSTRAINT "PolicyVersion_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "CompanyPolicy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyAcknowledgement" ADD CONSTRAINT "PolicyAcknowledgement_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "PolicyVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyAcknowledgement" ADD CONSTRAINT "PolicyAcknowledgement_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

