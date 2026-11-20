-- CreateTable
CREATE TABLE "HourlyPayLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "clientId" TEXT,
    "contractId" TEXT,
    "beatId" TEXT,
    "structureCode" TEXT NOT NULL,
    "dayClass" "DayClass" NOT NULL,
    "minutes" INTEGER NOT NULL,
    "rateId" TEXT,
    "rate" DECIMAL(14,2) NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "entryIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HourlyPayLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HourlyPayLine_organizationId_runId_idx" ON "HourlyPayLine"("organizationId", "runId");

-- CreateIndex
CREATE INDEX "HourlyPayLine_recordId_idx" ON "HourlyPayLine"("recordId");

-- AddForeignKey
ALTER TABLE "HourlyPayLine" ADD CONSTRAINT "HourlyPayLine_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HourlyPayLine" ADD CONSTRAINT "HourlyPayLine_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "PayrollRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Hourly pay, phase 4b (docs/plans/hourly-payroll-phase4b-explain-back.md). Everything above is new and additive: no existing table or row is changed. A line has at least one minute and never a negative rate or amount.
ALTER TABLE "HourlyPayLine" ADD CONSTRAINT "HourlyPayLine_values_check" CHECK ("minutes" >= 1 AND "rate" >= 0 AND "amount" >= 0);
