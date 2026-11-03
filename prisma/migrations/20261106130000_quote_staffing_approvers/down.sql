-- Reverses migration.sql. The designated approvers and the personnel needed on every quote line are lost (cost then follows the billed headcount again); the 15% default goes back to none.
DROP TABLE "CrmQuoteApprover";
ALTER TABLE "CrmQuoteLine" DROP COLUMN "requiredPersonnel";
ALTER TABLE "CrmSetting" ALTER COLUMN "minMarginBps" SET DEFAULT 0;
