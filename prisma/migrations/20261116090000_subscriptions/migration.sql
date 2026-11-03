-- Modules, plans and subscriptions (docs/plans/module-entitlements-e2.md). Tables and a data step only: nothing reads them to switch anything on or off yet.


-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'ENDED');

-- CreateEnum
CREATE TYPE "SubscriptionModuleSource" AS ENUM ('PLAN', 'ADD_ON', 'GRANDFATHERED');

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "planKey" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "catalogueVersion" TEXT NOT NULL,
    "employeeLimit" INTEGER,
    "crmUserLimit" INTEGER,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionModule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "moduleKey" TEXT NOT NULL,
    "source" "SubscriptionModuleSource" NOT NULL,
    "startsOn" TIMESTAMP(3) NOT NULL,
    "endsOn" TIMESTAMP(3),
    "readOnlyUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionModule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "reason" TEXT,
    "byUserId" TEXT,
    "byName" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientBlueprint" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "opportunityId" TEXT,
    "prospectName" TEXT NOT NULL,
    "planKey" TEXT NOT NULL,
    "modules" JSONB NOT NULL,
    "answers" JSONB NOT NULL,
    "reasons" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientBlueprint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_organizationId_key" ON "Subscription"("organizationId");

-- CreateIndex
CREATE INDEX "SubscriptionModule_subscriptionId_moduleKey_idx" ON "SubscriptionModule"("subscriptionId", "moduleKey");

-- CreateIndex
CREATE INDEX "SubscriptionModule_organizationId_idx" ON "SubscriptionModule"("organizationId");

-- CreateIndex
CREATE INDEX "SubscriptionEvent_subscriptionId_createdAt_idx" ON "SubscriptionEvent"("subscriptionId", "createdAt");

-- CreateIndex
CREATE INDEX "SubscriptionEvent_organizationId_idx" ON "SubscriptionEvent"("organizationId");

-- CreateIndex
CREATE INDEX "ClientBlueprint_organizationId_createdAt_idx" ON "ClientBlueprint"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "ClientBlueprint_opportunityId_idx" ON "ClientBlueprint"("opportunityId");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionModule" ADD CONSTRAINT "SubscriptionModule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionModule" ADD CONSTRAINT "SubscriptionModule_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionEvent" ADD CONSTRAINT "SubscriptionEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionEvent" ADD CONSTRAINT "SubscriptionEvent_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientBlueprint" ADD CONSTRAINT "ClientBlueprint_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientBlueprint" ADD CONSTRAINT "ClientBlueprint_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "CrmOpportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- A subscription event is a record of a change that was made. It can never be changed or deleted by anyone, the application included.
CREATE FUNCTION wfp_subscription_event_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'A subscription event cannot be changed or deleted.' USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wfp_subscription_event_append_only
  BEFORE UPDATE OR DELETE ON "SubscriptionEvent"
  FOR EACH ROW EXECUTE FUNCTION wfp_subscription_event_append_only();

-- BEGIN grandfathering
-- Every company that exists now and has no subscription gets the Custom plan with each module that is built or partly built (the catalogue
-- marks three as planned: production_pay, service_charge_pay and integrations, left out), each marked as grandfathered, so nothing a company
-- uses today stops. They are to be reviewed and given real plans later. A company that already has one is left alone, so it is safe to run twice.
WITH new_subs AS (
  INSERT INTO "Subscription" ("id", "organizationId", "planKey", "status", "catalogueVersion", "createdBy", "createdAt", "updatedAt")
  SELECT gen_random_uuid()::text, o."id", 'custom', 'ACTIVE', '2026-11-03', 'migration', now(), now()
  FROM "Organization" o
  WHERE NOT EXISTS (SELECT 1 FROM "Subscription" s WHERE s."organizationId" = o."id")
  RETURNING "id", "organizationId"
), new_modules AS (
  INSERT INTO "SubscriptionModule" ("id", "organizationId", "subscriptionId", "moduleKey", "source", "startsOn", "createdAt")
  SELECT gen_random_uuid()::text, n."organizationId", n."id", k."key", 'GRANDFATHERED', now(), now()
  FROM new_subs n
  CROSS JOIN (VALUES ('core'), ('hr'), ('payroll'), ('time_attendance'), ('contracts_deployment'), ('crm'), ('client_billing'), ('self_service'), ('analytics'), ('accounting'), ('payables_procurement'), ('client_portal'), ('inventory')) AS k("key")
  RETURNING 1
)
INSERT INTO "SubscriptionEvent" ("id", "organizationId", "subscriptionId", "kind", "reason", "byUserId", "byName", "detail", "createdAt")
SELECT gen_random_uuid()::text, n."organizationId", n."id", 'GRANDFATHERED', 'Existed before subscriptions did', NULL, 'migration', '{"plan":"custom","modules":13}'::jsonb, now()
FROM new_subs n;
-- END grandfathering
