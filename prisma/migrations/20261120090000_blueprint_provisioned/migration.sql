-- E5c (docs/plans/module-entitlements-e5.md): when an accepted blueprint is applied to the client its lead became, the blueprint records when and to which client. Two empty columns: nothing is changed or lost.

-- AlterTable
ALTER TABLE "ClientBlueprint" ADD COLUMN     "provisionedAt" TIMESTAMP(3),
ADD COLUMN     "provisionedOrganizationId" TEXT;
