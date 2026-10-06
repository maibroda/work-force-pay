-- CreateEnum
CREATE TYPE "ContactKind" AS ENUM ('NEXT_OF_KIN', 'EMERGENCY_CONTACT', 'DEPENDANT', 'REFEREE');

-- CreateEnum
CREATE TYPE "GuarantorStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED', 'RELEASED');

-- AlterTable
ALTER TABLE "HrPolicy" ADD COLUMN     "emergencyContactsRequired" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "guarantorCategoryIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "guarantorMaxPerPerson" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "guarantorSeparateVerifier" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "guarantorsRequired" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "nextOfKinRequired" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "EmployeeContact" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "kind" "ContactKind" NOT NULL,
    "fullName" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "phone" TEXT,
    "altPhone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "dateOfBirth" DATE,
    "occupation" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isBeneficiary" BOOLEAN NOT NULL DEFAULT false,
    "benefitSharePct" INTEGER,
    "notes" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeGuarantor" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "altPhone" TEXT,
    "email" TEXT,
    "address" TEXT NOT NULL,
    "occupation" TEXT,
    "employer" TEXT,
    "employerAddress" TEXT,
    "idType" TEXT,
    "idNumber" TEXT,
    "yearsKnown" INTEGER,
    "guaranteeAmount" DECIMAL(14,2),
    "formReference" TEXT,
    "status" "GuarantorStatus" NOT NULL DEFAULT 'PENDING',
    "recordedBy" TEXT NOT NULL,
    "recordedByUserId" TEXT NOT NULL,
    "verifiedBy" TEXT,
    "verifiedByUserId" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verificationNote" TEXT,
    "releasedAt" TIMESTAMP(3),
    "releaseReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeGuarantor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmployeeContact_organizationId_employeeId_kind_idx" ON "EmployeeContact"("organizationId", "employeeId", "kind");

-- CreateIndex
CREATE INDEX "EmployeeGuarantor_organizationId_status_idx" ON "EmployeeGuarantor"("organizationId", "status");

-- CreateIndex
CREATE INDEX "EmployeeGuarantor_organizationId_employeeId_idx" ON "EmployeeGuarantor"("organizationId", "employeeId");

-- AddForeignKey
ALTER TABLE "EmployeeContact" ADD CONSTRAINT "EmployeeContact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeContact" ADD CONSTRAINT "EmployeeContact_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeGuarantor" ADD CONSTRAINT "EmployeeGuarantor_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeGuarantor" ADD CONSTRAINT "EmployeeGuarantor_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

