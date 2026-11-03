-- Reverses migration.sql: drops the indexes it added (the queries still work, only slower on a large company).
DROP INDEX "CrmAccount_organizationId_status_name_idx";
DROP INDEX "CrmAccount_organizationId_accountType_status_idx";
DROP INDEX "CrmContact_organizationId_status_lastName_firstName_idx";
DROP INDEX "CrmLead_organizationId_status_createdAt_idx";
DROP INDEX "CrmLead_organizationId_source_status_idx";
DROP INDEX "CrmOpportunity_organizationId_status_createdAt_idx";
DROP INDEX "CrmOpportunity_organizationId_pipelineId_status_idx";
DROP INDEX "CrmOpportunity_organizationId_status_lastActivityAt_idx";
DROP INDEX "CrmCase_organizationId_openedAt_idx";
DROP INDEX "CrmCase_contactId_idx";
DROP INDEX "CrmHandover_organizationId_createdAt_idx";
DROP INDEX "CrmActivity_organizationId_occurredAt_idx";
DROP INDEX "CrmTask_leadId_idx";
DROP INDEX "CrmTask_contactId_idx";
DROP INDEX "CrmTask_accountId_idx";
DROP INDEX "CrmNotification_organizationId_userId_createdAt_idx";
