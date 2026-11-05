-- The paid-days basis agreed with each client (set on the contract) and unpaid leave (the founder, 2026-11-05; docs/plans/paid-days-basis.md, docs/plans/founder-decisions-2026-11-05.md).
-- New tables and two additive columns. Nothing existing changes: a contract with no approved basis keeps the company's rule, and every existing leave request is paid leave.

-- CreateEnum
CREATE TYPE "PaidDaysBasis" AS ENUM ('CALENDAR_DAYS', 'WORKING_DAYS');

-- AlterTable
ALTER TABLE "LeavePolicy" ADD COLUMN "unpaidLeaveEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "LeaveRequest" ADD COLUMN "unpaid" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ContractPayBasis" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "basis" "PaidDaysBasis" NOT NULL,
    "excludePublicHolidays" BOOLEAN NOT NULL DEFAULT false,
    "workingDaysPerWeek" INTEGER,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "reason" TEXT NOT NULL,
    "status" "PayRateProposalStatus" NOT NULL DEFAULT 'PENDING',
    "proposedBy" TEXT NOT NULL,
    "proposedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedBy" TEXT,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,

    CONSTRAINT "ContractPayBasis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicHoliday" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicHoliday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HolidayCalendarYear" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "confirmedBy" TEXT NOT NULL,
    "confirmedByUserId" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HolidayCalendarYear_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContractPayBasis_organizationId_contractId_status_idx" ON "ContractPayBasis"("organizationId", "contractId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PublicHoliday_organizationId_date_key" ON "PublicHoliday"("organizationId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "HolidayCalendarYear_organizationId_year_key" ON "HolidayCalendarYear"("organizationId", "year");

-- AddForeignKey
ALTER TABLE "ContractPayBasis" ADD CONSTRAINT "ContractPayBasis_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractPayBasis" ADD CONSTRAINT "ContractPayBasis_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicHoliday" ADD CONSTRAINT "PublicHoliday_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HolidayCalendarYear" ADD CONSTRAINT "HolidayCalendarYear_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
