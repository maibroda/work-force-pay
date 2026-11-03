-- Reverses migration.sql. Every subscription, its modules and its history are lost, and so are saved blueprints; nothing else reads them yet.
-- Take a backup first if any of it has been used for real.
DROP TABLE "ClientBlueprint";
DROP TRIGGER wfp_subscription_event_append_only ON "SubscriptionEvent";
DROP TABLE "SubscriptionEvent";
DROP TABLE "SubscriptionModule";
DROP TABLE "Subscription";
DROP FUNCTION wfp_subscription_event_append_only();
DROP TYPE "SubscriptionModuleSource";
DROP TYPE "SubscriptionStatus";
