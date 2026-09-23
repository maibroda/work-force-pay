-- Backfill: every organization that existed before EmployerCostRule was introduced gets one default
-- rule (matching the values the app seeds for new demo orgs), so payroll for them keeps working —
-- assemble() now requires an active EmployerCostRule the same way it already requires a PayrollRule.
-- Idempotent: only inserts for an org that has no rule at all yet.
INSERT INTO "EmployerCostRule" (
  "id",
  "organizationId",
  "version",
  "itfPct",
  "nsitfPct",
  "nhfMedicalPct",
  "insurancePct",
  "uniformKitsPct",
  "recruitmentTrainingPct",
  "leaveRelieverPct",
  "outsourcingLeaveAllowancePct",
  "effectiveFrom",
  "effectiveTo",
  "createdAt"
)
SELECT
  'ecr_' || md5(o.id || clock_timestamp()::text || random()::text),
  o.id,
  '2026.1',
  1,
  1,
  0,
  7.5,
  25,
  10.5,
  22,
  20,
  '2020-01-01'::date,
  NULL,
  now()
FROM "Organization" o
WHERE NOT EXISTS (
  SELECT 1 FROM "EmployerCostRule" ecr WHERE ecr."organizationId" = o.id
);
