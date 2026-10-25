-- CreateTable
CREATE TABLE "PayrollReminderSetting" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "remindClient" BOOLEAN NOT NULL DEFAULT true,
    "remindTeam" BOOLEAN NOT NULL DEFAULT true,
    "leadDays" INTEGER NOT NULL DEFAULT 2,
    "extraEmails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollReminderSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollReminderLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "toEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollReminderLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PayrollReminderSetting_organizationId_key" ON "PayrollReminderSetting"("organizationId");

-- CreateIndex
CREATE INDEX "PayrollReminderLog_organizationId_sentAt_idx" ON "PayrollReminderLog"("organizationId", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollReminderLog_periodId_kind_toEmail_day_key" ON "PayrollReminderLog"("periodId", "kind", "toEmail", "day");

-- AddForeignKey
ALTER TABLE "PayrollReminderSetting" ADD CONSTRAINT "PayrollReminderSetting_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollReminderLog" ADD CONSTRAINT "PayrollReminderLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



ALTER TABLE "PayrollReminderSetting" ADD CONSTRAINT "PayrollReminderSetting_lead_days" CHECK ("leadDays" BETWEEN 0 AND 14);

-- The reminder log is the record of what was sent and the guard against sending it twice. It is never changed or removed.
CREATE OR REPLACE FUNCTION wfp_protect_reminder_log() RETURNS trigger AS $$
BEGIN
  IF current_setting('wfp.allow_ledger_reset', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'The reminder log cannot be changed or deleted.' USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wfp_reminder_log_protected
  BEFORE UPDATE OR DELETE ON "PayrollReminderLog"
  FOR EACH ROW EXECUTE FUNCTION wfp_protect_reminder_log();
