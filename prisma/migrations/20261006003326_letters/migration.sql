-- CreateEnum
CREATE TYPE "LetterType" AS ENUM ('OFFER', 'EMPLOYMENT_CONFIRMATION', 'PROBATION_CONFIRMATION', 'WARNING', 'EXIT_LETTER', 'EXPERIENCE', 'CLEARANCE_CERTIFICATE');

-- CreateTable
CREATE TABLE "LetterTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" "LetterType" NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "signatoryName" TEXT NOT NULL DEFAULT '',
    "signatoryTitle" TEXT NOT NULL DEFAULT 'Human Resources',
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LetterTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeneratedLetter" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "referenceNumber" TEXT NOT NULL,
    "type" "LetterType" NOT NULL,
    "recipientName" TEXT NOT NULL,
    "employeeId" TEXT,
    "candidateId" TEXT,
    "sourceId" TEXT,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "signatoryName" TEXT NOT NULL DEFAULT '',
    "signatoryTitle" TEXT NOT NULL DEFAULT '',
    "generatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeneratedLetter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LetterTemplate_organizationId_type_key" ON "LetterTemplate"("organizationId", "type");

-- CreateIndex
CREATE INDEX "GeneratedLetter_organizationId_employeeId_idx" ON "GeneratedLetter"("organizationId", "employeeId");

-- CreateIndex
CREATE INDEX "GeneratedLetter_organizationId_type_idx" ON "GeneratedLetter"("organizationId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "GeneratedLetter_organizationId_referenceNumber_key" ON "GeneratedLetter"("organizationId", "referenceNumber");

-- AddForeignKey
ALTER TABLE "LetterTemplate" ADD CONSTRAINT "LetterTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedLetter" ADD CONSTRAINT "GeneratedLetter_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedLetter" ADD CONSTRAINT "GeneratedLetter_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

