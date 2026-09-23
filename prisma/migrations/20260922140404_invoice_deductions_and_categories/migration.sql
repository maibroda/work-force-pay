-- CreateEnum
CREATE TYPE "InvoiceDeductionType" AS ENUM ('WITHHOLDING_TAX', 'LEAVE_ALLOWANCE', 'OTHER');

-- AlterTable
ALTER TABLE "ClientInvoice" ADD COLUMN     "totalDeductions" DECIMAL(16,2) NOT NULL DEFAULT 0,
ADD COLUMN     "whtAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
ADD COLUMN     "whtPct" DECIMAL(5,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ClientInvoiceLine" ADD COLUMN     "categoryName" TEXT,
ADD COLUMN     "contractId" TEXT,
ADD COLUMN     "rate" DECIMAL(14,2) NOT NULL DEFAULT 0,
ALTER COLUMN "days" DROP NOT NULL;

-- AlterTable
ALTER TABLE "PayrollAllocation" ADD COLUMN     "insurance" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "itf" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "leaveReliever" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "nhfMedical" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "nsitf" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "outsourcingLeaveAllowance" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "recruitmentTraining" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "uniformKits" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PayrollRule" ADD COLUMN     "backOfficeChargePct" DECIMAL(5,2) NOT NULL DEFAULT 15;

-- CreateTable
CREATE TABLE "ClientInvoiceDeduction" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "type" "InvoiceDeductionType" NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "supportingDocument" TEXT NOT NULL,
    "recordedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientInvoiceDeduction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientInvoiceDeduction_organizationId_invoiceId_idx" ON "ClientInvoiceDeduction"("organizationId", "invoiceId");

-- CreateIndex
CREATE INDEX "ClientInvoiceDeduction_organizationId_clientId_idx" ON "ClientInvoiceDeduction"("organizationId", "clientId");

-- AddForeignKey
ALTER TABLE "ClientInvoiceLine" ADD CONSTRAINT "ClientInvoiceLine_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientInvoiceDeduction" ADD CONSTRAINT "ClientInvoiceDeduction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientInvoiceDeduction" ADD CONSTRAINT "ClientInvoiceDeduction_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "ClientInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientInvoiceDeduction" ADD CONSTRAINT "ClientInvoiceDeduction_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
