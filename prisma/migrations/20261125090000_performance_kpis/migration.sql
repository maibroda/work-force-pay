-- Job descriptions and KPIs that feed the appraisal (the founder, 2026-11-06; docs/plans/performance-management-phase1.md).
-- Three new tables, three enums and five additive columns. Nothing existing changes: a cycle with a KPI share of 0 (the default) scores exactly as before.

-- CreateEnum
CREATE TYPE "KpiUnit" AS ENUM ('PERCENT', 'COUNT', 'NAIRA', 'RATING');

-- CreateEnum
CREATE TYPE "KpiDirection" AS ENUM ('HIGHER_IS_BETTER', 'LOWER_IS_BETTER');

-- CreateEnum
CREATE TYPE "JobDescriptionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

-- AlterTable
ALTER TABLE "Appraisal" ADD COLUMN     "criteriaScore" DECIMAL(4,2),
ADD COLUMN     "jobDescriptionId" TEXT,
ADD COLUMN     "kpiScore" INTEGER;

-- AlterTable
ALTER TABLE "AppraisalCycle" ADD COLUMN     "kpiSharePct" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "HrPolicy" ADD COLUMN     "kpiBands" JSONB;

-- CreateTable
CREATE TABLE "JobDescription" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "purpose" TEXT,
    "responsibilities" TEXT,
    "status" "JobDescriptionStatus" NOT NULL DEFAULT 'DRAFT',
    "draftedBy" TEXT NOT NULL,
    "draftedByUserId" TEXT,
    "activatedBy" TEXT,
    "activatedByUserId" TEXT,
    "activatedAt" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobDescription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Kpi" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "jobDescriptionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "unit" "KpiUnit" NOT NULL,
    "direction" "KpiDirection" NOT NULL,
    "target" DECIMAL(16,4) NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 10,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Kpi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppraisalKpi" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "appraisalId" TEXT NOT NULL,
    "kpiId" TEXT NOT NULL,
    "kpiName" TEXT NOT NULL,
    "unit" "KpiUnit" NOT NULL,
    "direction" "KpiDirection" NOT NULL,
    "target" DECIMAL(16,4) NOT NULL,
    "weight" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "actual" DECIMAL(16,4),
    "comment" TEXT,
    "achievementBp" INTEGER,
    "score" INTEGER,

    CONSTRAINT "AppraisalKpi_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobDescription_organizationId_categoryId_status_idx" ON "JobDescription"("organizationId", "categoryId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "JobDescription_organizationId_categoryId_version_key" ON "JobDescription"("organizationId", "categoryId", "version");

-- CreateIndex
CREATE INDEX "Kpi_organizationId_idx" ON "Kpi"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Kpi_jobDescriptionId_name_key" ON "Kpi"("jobDescriptionId", "name");

-- CreateIndex
CREATE INDEX "AppraisalKpi_organizationId_idx" ON "AppraisalKpi"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "AppraisalKpi_appraisalId_kpiId_key" ON "AppraisalKpi"("appraisalId", "kpiId");

-- AddForeignKey
ALTER TABLE "Appraisal" ADD CONSTRAINT "Appraisal_jobDescriptionId_fkey" FOREIGN KEY ("jobDescriptionId") REFERENCES "JobDescription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobDescription" ADD CONSTRAINT "JobDescription_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobDescription" ADD CONSTRAINT "JobDescription_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "EmployeeCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Kpi" ADD CONSTRAINT "Kpi_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Kpi" ADD CONSTRAINT "Kpi_jobDescriptionId_fkey" FOREIGN KEY ("jobDescriptionId") REFERENCES "JobDescription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppraisalKpi" ADD CONSTRAINT "AppraisalKpi_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppraisalKpi" ADD CONSTRAINT "AppraisalKpi_appraisalId_fkey" FOREIGN KEY ("appraisalId") REFERENCES "Appraisal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppraisalKpi" ADD CONSTRAINT "AppraisalKpi_kpiId_fkey" FOREIGN KEY ("kpiId") REFERENCES "Kpi"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

