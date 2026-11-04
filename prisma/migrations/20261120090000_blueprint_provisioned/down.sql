-- Reverses migration.sql. The record of which client each blueprint was applied to is lost (the clients themselves are untouched).
ALTER TABLE "ClientBlueprint" DROP COLUMN "provisionedOrganizationId",
DROP COLUMN "provisionedAt";
