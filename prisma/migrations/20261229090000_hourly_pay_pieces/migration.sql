-- CreateEnum
CREATE TYPE "HourlyPieceKind" AS ENUM ('PAID', 'CREDITED');

-- CreateTable
CREATE TABLE "HourlyPayPiece" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "recordId" TEXT,
    "employeeId" TEXT NOT NULL,
    "segmentId" TEXT NOT NULL,
    "kind" "HourlyPieceKind" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HourlyPayPiece_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HourlyPayPiece_organizationId_runId_idx" ON "HourlyPayPiece"("organizationId", "runId");

-- CreateIndex
CREATE INDEX "HourlyPayPiece_recordId_idx" ON "HourlyPayPiece"("recordId");

-- CreateIndex
CREATE INDEX "HourlyPayPiece_segmentId_idx" ON "HourlyPayPiece"("segmentId");

-- AddForeignKey
ALTER TABLE "HourlyPayPiece" ADD CONSTRAINT "HourlyPayPiece_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HourlyPayPiece" ADD CONSTRAINT "HourlyPayPiece_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "PayrollRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HourlyPayPiece" ADD CONSTRAINT "HourlyPayPiece_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "TimeEntrySegment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

