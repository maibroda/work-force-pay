-- Reverses migration.sql. Paying banks, their code lists and the trace columns on the export record are lost; the generic bank file and every other table are untouched.
ALTER TABLE "PaymentFileExport" DROP CONSTRAINT "PaymentFileExport_payingBankId_fkey";
ALTER TABLE "PaymentFileExport" DROP COLUMN "layoutHeaders";
ALTER TABLE "PaymentFileExport" DROP COLUMN "codeSetVersion";
ALTER TABLE "PaymentFileExport" DROP COLUMN "payingBankId";
DROP TABLE "PayingBankCode";
DROP TABLE "BankCodeSet";
DROP TABLE "PayingBank";
