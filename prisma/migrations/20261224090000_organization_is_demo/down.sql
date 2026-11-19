-- Reverses 20261224090000_organization_is_demo: removes the flag that marks a company as the seed's fictional demo company.
-- Nothing else is changed. Without the flag the application cannot tell a demo company from a real one, so run this only on a database that is being rolled back as a whole.

ALTER TABLE "Organization" DROP COLUMN "isDemo";
