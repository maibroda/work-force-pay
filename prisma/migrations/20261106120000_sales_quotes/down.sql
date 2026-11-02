-- Reverses migration.sql. Every quote and its lines, and the minimum-margin setting, are lost; deals, accounts and everything else stay.
DROP TRIGGER "CrmQuoteLine_guard" ON "CrmQuoteLine";
DROP FUNCTION crm_quote_line_guard();
DROP TABLE "CrmQuoteLine";
DROP TABLE "CrmQuote";
ALTER TABLE "CrmSetting" DROP COLUMN "minMarginBps";
DROP TYPE "CrmQuoteStatus";
