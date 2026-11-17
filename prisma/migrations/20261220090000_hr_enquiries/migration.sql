-- CreateEnum
CREATE TYPE "HrEnquiryCategory" AS ENUM ('PAY', 'LEAVE', 'LETTER', 'POLICY', 'BENEFITS', 'OTHER');

-- CreateEnum
CREATE TYPE "HrEnquiryStatus" AS ENUM ('OPEN', 'ANSWERED', 'CLOSED');

-- AlterTable
ALTER TABLE "HrPolicy" ADD COLUMN     "enquiryResponseDays" INTEGER NOT NULL DEFAULT 3;

-- CreateTable
CREATE TABLE "HrEnquiry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "category" "HrEnquiryCategory" NOT NULL,
    "subject" TEXT NOT NULL,
    "status" "HrEnquiryStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstResponseAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closedBy" TEXT,
    "movedToCaseId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrEnquiry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrEnquiryMessage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "enquiryId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrEnquiryMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HrEnquiry_organizationId_status_idx" ON "HrEnquiry"("organizationId", "status");

-- CreateIndex
CREATE INDEX "HrEnquiry_organizationId_employeeId_idx" ON "HrEnquiry"("organizationId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "HrEnquiry_organizationId_number_key" ON "HrEnquiry"("organizationId", "number");

-- CreateIndex
CREATE INDEX "HrEnquiryMessage_enquiryId_createdAt_idx" ON "HrEnquiryMessage"("enquiryId", "createdAt");

-- AddForeignKey
ALTER TABLE "HrEnquiry" ADD CONSTRAINT "HrEnquiry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrEnquiry" ADD CONSTRAINT "HrEnquiry_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrEnquiryMessage" ADD CONSTRAINT "HrEnquiryMessage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrEnquiryMessage" ADD CONSTRAINT "HrEnquiryMessage_enquiryId_fkey" FOREIGN KEY ("enquiryId") REFERENCES "HrEnquiry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

