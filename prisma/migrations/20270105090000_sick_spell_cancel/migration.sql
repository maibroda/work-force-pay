-- AlterTable
ALTER TABLE "SickSpell" ADD COLUMN     "cancelledBy" TEXT,
ADD COLUMN     "cancelledByUserId" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancellationNote" TEXT,
ADD COLUMN     "overpaymentRunId" TEXT;
