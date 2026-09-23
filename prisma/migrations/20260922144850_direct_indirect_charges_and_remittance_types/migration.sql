-- AlterTable
ALTER TABLE "ClientInvoice" ADD COLUMN     "directChargePct" DECIMAL(5,2) NOT NULL DEFAULT 90,
ADD COLUMN     "indirectChargePct" DECIMAL(5,2) NOT NULL DEFAULT 10,
ADD COLUMN     "totalDirectCharge" DECIMAL(16,2) NOT NULL DEFAULT 0,
ADD COLUMN     "totalIndirectCharge" DECIMAL(16,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ClientInvoiceLine" ADD COLUMN     "directCharge" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "indirectCharge" DECIMAL(14,2) NOT NULL DEFAULT 0;
