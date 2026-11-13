-- Reverses 20261211090000_retention_schedule_and_holds. Only what it added is dropped: the retention rules, the legal holds and their four types. Nothing else is touched.
DROP TABLE "RetentionHold";
DROP TABLE "RetentionRule";
DROP TYPE "RetentionHoldScope";
DROP TYPE "RetentionAction";
DROP TYPE "RetentionTrigger";
DROP TYPE "RetentionCategory";
