-- Reverses migration.sql. The switch and its history are lost; every module is then simply not checked, which is how it starts.
DROP TRIGGER wfp_entitlement_switch_event_append_only ON "EntitlementSwitchEvent";
DROP TABLE "EntitlementSwitchEvent";
DROP TABLE "EntitlementSwitch";
DROP FUNCTION wfp_entitlement_switch_event_append_only();
DROP TYPE "EntitlementMode";
