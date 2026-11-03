-- Paying banks: the bank a client pays salaries from, with its own versioned code list and its own upload file layout, both as data (docs/plans/paying-bank-files.md).
-- New tables, and three nullable columns on the export record; nothing existing is rewritten, and the generic bank file keeps working as before.
-- To reverse, run down.sql in this folder (Prisma runs only migration.sql).

CREATE TABLE "PayingBank" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "layout" JSONB,
    "debitAccountNumber" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PayingBank_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PayingBank_organizationId_name_key" ON "PayingBank"("organizationId", "name");

CREATE TABLE "BankCodeSet" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "payingBankId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "sourceName" TEXT NOT NULL,
    "sourceSha256" TEXT NOT NULL,
    "entryCount" INTEGER NOT NULL,
    "blockedCount" INTEGER NOT NULL,
    "importedBy" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BankCodeSet_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BankCodeSet_payingBankId_version_key" ON "BankCodeSet"("payingBankId", "version");

CREATE TABLE "PayingBankCode" (
    "id" TEXT NOT NULL,
    "codeSetId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "blockedReason" TEXT,
    CONSTRAINT "PayingBankCode_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PayingBankCode_codeSetId_code_idx" ON "PayingBankCode"("codeSetId", "code");

ALTER TABLE "PaymentFileExport" ADD COLUMN "payingBankId" TEXT;
ALTER TABLE "PaymentFileExport" ADD COLUMN "codeSetVersion" INTEGER;
ALTER TABLE "PaymentFileExport" ADD COLUMN "layoutHeaders" TEXT;

ALTER TABLE "PayingBank" ADD CONSTRAINT "PayingBank_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BankCodeSet" ADD CONSTRAINT "BankCodeSet_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BankCodeSet" ADD CONSTRAINT "BankCodeSet_payingBankId_fkey" FOREIGN KEY ("payingBankId") REFERENCES "PayingBank"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayingBankCode" ADD CONSTRAINT "PayingBankCode_codeSetId_fkey" FOREIGN KEY ("codeSetId") REFERENCES "BankCodeSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentFileExport" ADD CONSTRAINT "PaymentFileExport_payingBankId_fkey" FOREIGN KEY ("payingBankId") REFERENCES "PayingBank"("id") ON DELETE SET NULL ON UPDATE CASCADE;
