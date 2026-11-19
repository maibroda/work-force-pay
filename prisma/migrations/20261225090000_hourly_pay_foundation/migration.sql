-- CreateEnum
CREATE TYPE "CompensationType" AS ENUM ('MONTHLY', 'HOURLY');

-- CreateEnum
CREATE TYPE "HourlyRateScope" AS ENUM ('EMPLOYEE', 'CONTRACT_CATEGORY', 'CATEGORY');

-- CreateTable
CREATE TABLE "PublicHolidayState" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "holidayId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicHolidayState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HourlyPaySetting" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "changedBy" TEXT NOT NULL,
    "changedByUserId" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HourlyPaySetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HourlyRate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "scope" "HourlyRateScope" NOT NULL,
    "employeeId" TEXT,
    "contractId" TEXT,
    "categoryId" TEXT,
    "weekdayRate" DECIMAL(14,2) NOT NULL,
    "weekendRate" DECIMAL(14,2) NOT NULL,
    "holidayRate" DECIMAL(14,2) NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "reason" TEXT NOT NULL,
    "status" "PayRateProposalStatus" NOT NULL DEFAULT 'PENDING',
    "proposedBy" TEXT NOT NULL,
    "proposedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedBy" TEXT,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,

    CONSTRAINT "HourlyRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeCompensationType" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "type" "CompensationType" NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "PayRateProposalStatus" NOT NULL DEFAULT 'PENDING',
    "proposedBy" TEXT NOT NULL,
    "proposedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedBy" TEXT,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,

    CONSTRAINT "EmployeeCompensationType_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PublicHolidayState_organizationId_idx" ON "PublicHolidayState"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PublicHolidayState_holidayId_state_key" ON "PublicHolidayState"("holidayId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "HourlyPaySetting_organizationId_key" ON "HourlyPaySetting"("organizationId");

-- CreateIndex
CREATE INDEX "HourlyRate_organizationId_status_idx" ON "HourlyRate"("organizationId", "status");

-- CreateIndex
CREATE INDEX "HourlyRate_organizationId_scope_employeeId_idx" ON "HourlyRate"("organizationId", "scope", "employeeId");

-- CreateIndex
CREATE INDEX "HourlyRate_organizationId_scope_contractId_categoryId_idx" ON "HourlyRate"("organizationId", "scope", "contractId", "categoryId");

-- CreateIndex
CREATE INDEX "EmployeeCompensationType_organizationId_employeeId_status_idx" ON "EmployeeCompensationType"("organizationId", "employeeId", "status");

-- AddForeignKey
ALTER TABLE "PublicHolidayState" ADD CONSTRAINT "PublicHolidayState_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicHolidayState" ADD CONSTRAINT "PublicHolidayState_holidayId_fkey" FOREIGN KEY ("holidayId") REFERENCES "PublicHoliday"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HourlyPaySetting" ADD CONSTRAINT "HourlyPaySetting_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HourlyRate" ADD CONSTRAINT "HourlyRate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HourlyRate" ADD CONSTRAINT "HourlyRate_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HourlyRate" ADD CONSTRAINT "HourlyRate_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HourlyRate" ADD CONSTRAINT "HourlyRate_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "EmployeeCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeCompensationType" ADD CONSTRAINT "EmployeeCompensationType_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeCompensationType" ADD CONSTRAINT "EmployeeCompensationType_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hourly pay, phase 2 (docs/plans/hourly-payroll-phase2-explain-back.md). Everything above is new and additive: no existing table or row is changed, and nothing reads these tables in the pay run yet.

-- A rate belongs to exactly the one scope its keys say: the employee's own rate, a contract and job role, or a job role.
ALTER TABLE "HourlyRate" ADD CONSTRAINT "HourlyRate_scope_keys_check" CHECK (
  ("scope" = 'EMPLOYEE' AND "employeeId" IS NOT NULL AND "contractId" IS NULL AND "categoryId" IS NULL)
  OR ("scope" = 'CONTRACT_CATEGORY' AND "employeeId" IS NULL AND "contractId" IS NOT NULL AND "categoryId" IS NOT NULL)
  OR ("scope" = 'CATEGORY' AND "employeeId" IS NULL AND "contractId" IS NULL AND "categoryId" IS NOT NULL)
);
ALTER TABLE "HourlyRate" ADD CONSTRAINT "HourlyRate_rates_check" CHECK ("weekdayRate" >= 0 AND "weekendRate" >= 0 AND "holidayRate" >= 0);
ALTER TABLE "HourlyRate" ADD CONSTRAINT "HourlyRate_dates_check" CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom");

-- An hourly rate is history: it is never deleted, and once it has been decided nothing about it changes except that a later rate may end it (set its end date, once).
CREATE FUNCTION wfp_hourly_rate_protect() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'An hourly rate is kept for the record and cannot be deleted; end it with a new rate from a later date.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."status" <> 'PENDING' AND (
       NEW."status" IS DISTINCT FROM OLD."status"
    OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
    OR NEW."scope" IS DISTINCT FROM OLD."scope"
    OR NEW."employeeId" IS DISTINCT FROM OLD."employeeId"
    OR NEW."contractId" IS DISTINCT FROM OLD."contractId"
    OR NEW."categoryId" IS DISTINCT FROM OLD."categoryId"
    OR NEW."weekdayRate" IS DISTINCT FROM OLD."weekdayRate"
    OR NEW."weekendRate" IS DISTINCT FROM OLD."weekendRate"
    OR NEW."holidayRate" IS DISTINCT FROM OLD."holidayRate"
    OR NEW."effectiveFrom" IS DISTINCT FROM OLD."effectiveFrom"
    OR NEW."reason" IS DISTINCT FROM OLD."reason"
    OR NEW."proposedBy" IS DISTINCT FROM OLD."proposedBy"
    OR NEW."proposedByUserId" IS DISTINCT FROM OLD."proposedByUserId"
    OR NEW."decidedBy" IS DISTINCT FROM OLD."decidedBy"
    OR NEW."decidedByUserId" IS DISTINCT FROM OLD."decidedByUserId"
    OR NEW."decidedAt" IS DISTINCT FROM OLD."decidedAt"
    OR NEW."decisionNote" IS DISTINCT FROM OLD."decisionNote"
  ) THEN
    RAISE EXCEPTION 'A decided hourly rate cannot be changed; propose a new rate from a later date.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."effectiveTo" IS NOT NULL AND NEW."effectiveTo" IS DISTINCT FROM OLD."effectiveTo" THEN
    RAISE EXCEPTION 'The end date of an hourly rate cannot be changed once it is set.' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wfp_hourly_rate_protected
  BEFORE UPDATE OR DELETE ON "HourlyRate"
  FOR EACH ROW EXECUTE FUNCTION wfp_hourly_rate_protect();

-- How a person is paid, from a date: never deleted, and not changed once decided.
CREATE FUNCTION wfp_compensation_type_protect() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A record of how a person is paid is kept and cannot be deleted; record a new one from a later date.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."status" <> 'PENDING' THEN
    RAISE EXCEPTION 'A decided record of how a person is paid cannot be changed; record a new one from a later date.' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wfp_compensation_type_protected
  BEFORE UPDATE OR DELETE ON "EmployeeCompensationType"
  FOR EACH ROW EXECUTE FUNCTION wfp_compensation_type_protect();
