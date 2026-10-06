-- CreateEnum
CREATE TYPE "DataRequestStatus" AS ENUM ('OPEN', 'FULFILLED', 'REFUSED');

-- AlterTable
ALTER TABLE "HrPolicy" ADD COLUMN     "dsarResponseDays" INTEGER NOT NULL DEFAULT 30;

-- CreateTable
CREATE TABLE "DataAccessRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requestNumber" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "requesterName" TEXT NOT NULL,
    "channel" TEXT,
    "receivedOn" DATE NOT NULL,
    "dueOn" DATE NOT NULL,
    "status" "DataRequestStatus" NOT NULL DEFAULT 'OPEN',
    "identityVerified" BOOLEAN NOT NULL DEFAULT false,
    "identityNote" TEXT,
    "verifiedBy" TEXT,
    "exportedAt" TIMESTAMP(3),
    "exportChecksum" TEXT,
    "exportSections" JSONB,
    "handledBy" TEXT,
    "completedOn" TIMESTAMP(3),
    "completionNote" TEXT,
    "refusalReason" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataAccessRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DataAccessRequest_organizationId_status_idx" ON "DataAccessRequest"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DataAccessRequest_organizationId_requestNumber_key" ON "DataAccessRequest"("organizationId", "requestNumber");

-- AddForeignKey
ALTER TABLE "DataAccessRequest" ADD CONSTRAINT "DataAccessRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataAccessRequest" ADD CONSTRAINT "DataAccessRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

