-- Sales Phase 7b (docs/crm/07b-phase-7b-plan.md): the latest health score of each client account, and the weights an organization may set for its six measures.
-- One new table, one new type and one nullable column on CrmSetting. Nothing existing is changed.
-- To reverse, run down.sql in this folder (Prisma runs only migration.sql).

-- CreateEnum
CREATE TYPE "CrmHealthBand" AS ENUM ('HEALTHY', 'WATCH', 'AT_RISK');

-- AlterTable
ALTER TABLE "CrmSetting" ADD COLUMN     "healthWeights" JSONB;

-- CreateTable
CREATE TABLE "CrmAccountHealth" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "band" "CrmHealthBand" NOT NULL,
    "components" JSONB NOT NULL,
    "previousBand" "CrmHealthBand",
    "bandChangedAt" TIMESTAMP(3),
    "computedAt" TIMESTAMP(3) NOT NULL,

CONSTRAINT "CrmAccountHealth_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CrmAccountHealth_accountId_key" ON "CrmAccountHealth"("accountId");

-- CreateIndex
CREATE INDEX "CrmAccountHealth_organizationId_band_score_idx" ON "CrmAccountHealth"("organizationId", "band", "score");

-- AddForeignKey
ALTER TABLE "CrmAccountHealth" ADD CONSTRAINT "CrmAccountHealth_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmAccountHealth" ADD CONSTRAINT "CrmAccountHealth_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "CrmAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
