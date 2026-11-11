-- CreateEnum
CREATE TYPE "HrFunction" AS ENUM ('WELFARE', 'SURVEYS', 'SURVEY_ASSIST', 'SUCCESSION');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'HR_OFFICER';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "accessEndsOn" DATE,
ADD COLUMN     "external" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "UserFunctionGrant" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "function" "HrFunction" NOT NULL,
    "reason" TEXT NOT NULL,
    "grantedByUserId" TEXT NOT NULL,
    "grantedBy" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsOn" DATE,
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,
    "revokedBy" TEXT,
    "revokeReason" TEXT,

    CONSTRAINT "UserFunctionGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserFunctionGrant_userId_function_idx" ON "UserFunctionGrant"("userId", "function");

-- CreateIndex
CREATE INDEX "UserFunctionGrant_organizationId_idx" ON "UserFunctionGrant"("organizationId");

-- AddForeignKey
ALTER TABLE "UserFunctionGrant" ADD CONSTRAINT "UserFunctionGrant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserFunctionGrant" ADD CONSTRAINT "UserFunctionGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

