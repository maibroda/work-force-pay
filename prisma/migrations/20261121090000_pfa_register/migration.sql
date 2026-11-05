-- From the founder's review (2026-11-04): the company administrator or the HR manager must be able to add or remove a pension fund administrator. Until now the nine were a list in the code.
-- A new table, one list per company. Nothing existing is changed or lost: an employee's pfa stays the name, as before.

-- CreateTable
CREATE TABLE "PensionFundAdministrator" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "penComNumber" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PensionFundAdministrator_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PensionFundAdministrator_organizationId_name_key" ON "PensionFundAdministrator"("organizationId", "name");

-- AddForeignKey
ALTER TABLE "PensionFundAdministrator" ADD CONSTRAINT "PensionFundAdministrator_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- BEGIN seed
-- Every company that has no list yet is given the nine the form used to offer, plus every PFA already typed on one of its employees (once, whatever the capitals), so no employee's PFA falls off the list.
INSERT INTO "PensionFundAdministrator" ("id", "organizationId", "name", "active", "createdBy", "updatedAt")
SELECT 'pfa' || md5(o."id" || lower(n.name)), o."id", n.name, true, 'System (migration)', CURRENT_TIMESTAMP
FROM "Organization" o
CROSS JOIN LATERAL (
  SELECT DISTINCT ON (lower(x.name)) x.name
  FROM (
    SELECT d.name, 0 AS pri FROM unnest(ARRAY['Stanbic IBTC Pension Managers','Access ARM Pensions','Leadway Pensure PFA','Premium Pension Ltd','Crusader Sterling Pensions','Fidelity Pension Managers','Trustfund Pensions','NLPC Pension Fund Administrators','Tangerine APT Pensions']) AS d(name)
    UNION ALL
    SELECT btrim(regexp_replace(e."pfa", '\s+', ' ', 'g')), 1 FROM "Employee" e WHERE e."organizationId" = o."id" AND btrim(coalesce(e."pfa", '')) <> ''
  ) x
  ORDER BY lower(x.name), x.pri, x.name
) n
WHERE NOT EXISTS (SELECT 1 FROM "PensionFundAdministrator" p WHERE p."organizationId" = o."id");
-- END seed
