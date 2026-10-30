-- Reverses migration.sql. Every stored health score is lost (it is worked out again by the nightly job), and any weights an organization set.
DROP TABLE "CrmAccountHealth";
ALTER TABLE "CrmSetting" DROP COLUMN "healthWeights";
DROP TYPE "CrmHealthBand";
