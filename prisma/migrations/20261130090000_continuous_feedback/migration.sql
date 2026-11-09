-- Performance management, step (c): continuous feedback (the founder, 2026-11-07; plan: docs/plans/continuous-feedback-plan.md).
-- Additive only: one enum and one new table of short, dated notes about an employee from their reporting manager or HR. Nothing existing changes and no existing row is rewritten.

-- CreateEnum
CREATE TYPE "FeedbackKind" AS ENUM ('RECOGNITION', 'COACHING');

-- CreateTable
CREATE TABLE "PerformanceFeedback" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "authorEmployeeId" TEXT,
    "kind" "FeedbackKind" NOT NULL,
    "body" TEXT NOT NULL,
    "relatesOn" DATE NOT NULL,
    "employeeReply" TEXT,
    "employeeReplyAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "voidedByUserId" TEXT,
    "voidedBy" TEXT,
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PerformanceFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PerformanceFeedback_organizationId_employeeId_relatesOn_idx" ON "PerformanceFeedback"("organizationId", "employeeId", "relatesOn");

-- CreateIndex
CREATE INDEX "PerformanceFeedback_organizationId_authorUserId_idx" ON "PerformanceFeedback"("organizationId", "authorUserId");

-- AddForeignKey
ALTER TABLE "PerformanceFeedback" ADD CONSTRAINT "PerformanceFeedback_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceFeedback" ADD CONSTRAINT "PerformanceFeedback_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

