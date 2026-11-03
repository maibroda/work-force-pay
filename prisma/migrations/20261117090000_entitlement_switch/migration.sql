-- The module switch (docs/plans/module-entitlements-e3.md, step E3b): per module, OFF, REPORT or ENFORCE. Tables only, empty: every module starts OFF, so nothing changes for anyone.


-- CreateEnum
CREATE TYPE "EntitlementMode" AS ENUM ('OFF', 'REPORT', 'ENFORCE');

-- CreateTable
CREATE TABLE "EntitlementSwitch" (
    "moduleKey" TEXT NOT NULL,
    "mode" "EntitlementMode" NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EntitlementSwitch_pkey" PRIMARY KEY ("moduleKey")
);

-- CreateTable
CREATE TABLE "EntitlementSwitchEvent" (
    "id" TEXT NOT NULL,
    "moduleKey" TEXT NOT NULL,
    "fromMode" "EntitlementMode" NOT NULL,
    "toMode" "EntitlementMode" NOT NULL,
    "reason" TEXT NOT NULL,
    "byUserId" TEXT,
    "byName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EntitlementSwitchEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EntitlementSwitchEvent_createdAt_idx" ON "EntitlementSwitchEvent"("createdAt");


-- A switch event is a record of a change that was made. It can never be changed or deleted by anyone, the application included.
CREATE FUNCTION wfp_entitlement_switch_event_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'An entitlement switch event cannot be changed or deleted.' USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wfp_entitlement_switch_event_append_only
  BEFORE UPDATE OR DELETE ON "EntitlementSwitchEvent"
  FOR EACH ROW EXECUTE FUNCTION wfp_entitlement_switch_event_append_only();
