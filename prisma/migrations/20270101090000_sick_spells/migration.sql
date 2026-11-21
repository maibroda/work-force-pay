-- AlterTable
ALTER TABLE "LeavePolicy" ADD COLUMN     "sickDaysPerYear" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "SickSpell" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "cycleStart" DATE NOT NULL,
    "cycleEnd" DATE NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "workingDays" INTEGER NOT NULL,
    "certificateDocumentId" TEXT NOT NULL,
    "status" "LeaveStatus" NOT NULL DEFAULT 'PENDING',
    "recordedBy" TEXT NOT NULL,
    "recordedByUserId" TEXT NOT NULL,
    "decidedBy" TEXT,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SickSpell_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SickSpell_organizationId_employeeId_idx" ON "SickSpell"("organizationId", "employeeId");

-- CreateIndex
CREATE INDEX "SickSpell_organizationId_status_idx" ON "SickSpell"("organizationId", "status");

-- CreateIndex
CREATE INDEX "SickSpell_certificateDocumentId_idx" ON "SickSpell"("certificateDocumentId");

-- AddForeignKey
ALTER TABLE "SickSpell" ADD CONSTRAINT "SickSpell_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SickSpell" ADD CONSTRAINT "SickSpell_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SickSpell" ADD CONSTRAINT "SickSpell_certificateDocumentId_fkey" FOREIGN KEY ("certificateDocumentId") REFERENCES "EmployeeDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

