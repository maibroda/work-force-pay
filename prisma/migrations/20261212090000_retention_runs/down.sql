-- Reverses 20261212090000_retention_runs. Only what it added is dropped: the retention runs, their ledger of items and the run status type. Nothing else is touched.
DROP TABLE "RetentionRunItem";
DROP TABLE "RetentionRun";
DROP TYPE "RetentionRunStatus";
