-- Sales Phase 9b (docs/crm/09b-phase-9b-plan.md): indexes for the filters, orderings and lookups the sales lists and jobs use, so a list stays quick as a company's records grow.
-- Indexes only; no table, column or row is changed. To reverse, run down.sql in this folder (Prisma runs only migration.sql).

CREATE INDEX "CrmAccount_organizationId_status_name_idx" ON "CrmAccount"("organizationId", "status", "name");
CREATE INDEX "CrmAccount_organizationId_accountType_status_idx" ON "CrmAccount"("organizationId", "accountType", "status");
CREATE INDEX "CrmContact_organizationId_status_lastName_firstName_idx" ON "CrmContact"("organizationId", "status", "lastName", "firstName");
CREATE INDEX "CrmLead_organizationId_status_createdAt_idx" ON "CrmLead"("organizationId", "status", "createdAt");
CREATE INDEX "CrmLead_organizationId_source_status_idx" ON "CrmLead"("organizationId", "source", "status");
CREATE INDEX "CrmOpportunity_organizationId_status_createdAt_idx" ON "CrmOpportunity"("organizationId", "status", "createdAt");
CREATE INDEX "CrmOpportunity_organizationId_pipelineId_status_idx" ON "CrmOpportunity"("organizationId", "pipelineId", "status");
CREATE INDEX "CrmOpportunity_organizationId_status_lastActivityAt_idx" ON "CrmOpportunity"("organizationId", "status", "lastActivityAt");
CREATE INDEX "CrmCase_organizationId_openedAt_idx" ON "CrmCase"("organizationId", "openedAt");
CREATE INDEX "CrmCase_contactId_idx" ON "CrmCase"("contactId");
CREATE INDEX "CrmHandover_organizationId_createdAt_idx" ON "CrmHandover"("organizationId", "createdAt");
CREATE INDEX "CrmActivity_organizationId_occurredAt_idx" ON "CrmActivity"("organizationId", "occurredAt");
CREATE INDEX "CrmTask_leadId_idx" ON "CrmTask"("leadId");
CREATE INDEX "CrmTask_contactId_idx" ON "CrmTask"("contactId");
CREATE INDEX "CrmTask_accountId_idx" ON "CrmTask"("accountId");
CREATE INDEX "CrmNotification_organizationId_userId_createdAt_idx" ON "CrmNotification"("organizationId", "userId", "createdAt");
