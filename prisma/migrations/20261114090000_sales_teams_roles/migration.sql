-- Sales Phase 10 (docs/crm/10-phase-10-plan.md): three new roles (a company's salesperson, a sales manager, an account manager) and sales teams (a team, and its members).
-- Adds three values to the Role list and two new tables; nothing existing is changed.
-- THIS MIGRATION IS NOT FULLY REVERSIBLE: PostgreSQL cannot remove a value from an enumerated type. down.sql drops the two tables and REFUSES to run while any user holds a new role;
-- the three unused values then stay in the list, which is harmless. The founder agreed to this on 2026-11-02.

ALTER TYPE "Role" ADD VALUE 'SALES_REP';
ALTER TYPE "Role" ADD VALUE 'SALES_MANAGER';
ALTER TYPE "Role" ADD VALUE 'ACCOUNT_MANAGER';

-- CreateTable
CREATE TABLE "CrmTeam" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "managerUserId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "CrmTeam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmTeamMember" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "CrmTeamMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CrmTeam_organizationId_managerUserId_active_idx" ON "CrmTeam"("organizationId", "managerUserId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "CrmTeam_organizationId_name_key" ON "CrmTeam"("organizationId", "name");

-- CreateIndex
CREATE INDEX "CrmTeamMember_teamId_idx" ON "CrmTeamMember"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmTeamMember_organizationId_userId_key" ON "CrmTeamMember"("organizationId", "userId");

-- AddForeignKey
ALTER TABLE "CrmTeam" ADD CONSTRAINT "CrmTeam_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmTeamMember" ADD CONSTRAINT "CrmTeamMember_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmTeamMember" ADD CONSTRAINT "CrmTeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "CrmTeam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
