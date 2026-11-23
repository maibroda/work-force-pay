-- AlterTable
ALTER TABLE "HourlyPayLine" ADD COLUMN     "clientName" TEXT,
ADD COLUMN     "siteName" TEXT;

-- AlterTable
ALTER TABLE "HourlyAllowanceLine" ADD COLUMN     "clientName" TEXT,
ADD COLUMN     "siteName" TEXT;
