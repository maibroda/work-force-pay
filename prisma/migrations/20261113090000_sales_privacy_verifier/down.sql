-- Reverses migration.sql: the record of who checked each identity (by id) is lost; the name in "verifiedBy" stays.
ALTER TABLE "CrmDataRequest" DROP COLUMN "verifiedByUserId";
