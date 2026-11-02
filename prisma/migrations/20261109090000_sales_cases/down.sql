-- Reverses migration.sql. Every case, its history, SLA policy, business-hours setting, holiday and renewal link is lost.
DROP TRIGGER "CrmCaseEvent_immutable" ON "CrmCaseEvent";
DROP FUNCTION crm_case_event_immutable();
DROP TABLE "CrmRenewalLink";
DROP TABLE "CrmCaseEvent";
DROP TABLE "CrmCase";
DROP TABLE "CrmHoliday";
DROP TABLE "CrmBusinessHours";
DROP TABLE "CrmSlaPolicy";
ALTER TABLE "CrmSetting" DROP COLUMN "renewalWindowDays";
DROP TYPE "CrmCaseEventKind";
DROP TYPE "CrmCaseStatus";
DROP TYPE "CrmCaseCategory";
DROP TYPE "CrmCasePriority";
