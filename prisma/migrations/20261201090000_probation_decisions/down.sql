-- Reverses migration.sql. THE HISTORY OF PROBATION DECISIONS (who decided, when, why, the supporting appraisal and whether the employee was told) IS LOST, and the escalation setting.
-- The contracts keep their current probation outcome and notes; the audit log (which keeps its PROBATION_* entries) is unchanged. Take a copy of the table first if it has been used for real.
DROP TABLE "ProbationDecision";
ALTER TABLE "HrPolicy" DROP COLUMN "probationEscalationDays";
