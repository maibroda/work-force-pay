-- Reverses migration.sql. Everything entered in the sales module (accounts, contacts, leads, consent records, the switch) is lost; no other table is touched.
DROP TRIGGER "CrmConsent_immutable" ON "CrmConsent";
DROP FUNCTION crm_consent_immutable();
DROP TABLE "CrmConsent";
DROP TABLE "CrmLead";
DROP TABLE "CrmContact";
DROP TABLE "CrmAccount";
DROP TABLE "CrmSetting";
DROP TYPE "CrmChannel";
DROP TYPE "CrmConsentStatus";
DROP TYPE "CrmConsentPurpose";
DROP TYPE "CrmLeadStatus";
DROP TYPE "CrmDecisionRole";
DROP TYPE "CrmServiceInterest";
DROP TYPE "CrmSource";
DROP TYPE "CrmAccountType";
DROP TYPE "CrmRecordStatus";
DROP TYPE "CrmMode";
