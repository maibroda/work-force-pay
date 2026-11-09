-- Reverses migration.sql. EVERY PIECE OF FEEDBACK, THE EMPLOYEES' REPLIES AND THE VOID REASONS ARE LOST. Nothing else is touched: employees, appraisals and the audit log
-- (which keeps its FEEDBACK_* entries, by ids only) are unchanged. Take a copy of the table first if it has been used for real.
DROP TABLE "PerformanceFeedback";
DROP TYPE "FeedbackKind";
