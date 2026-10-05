-- AlterTable
ALTER TABLE "HrPolicy" ADD COLUMN     "lastDigestAt" TIMESTAMP(3),
ADD COLUMN     "reminderEmailsEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "reminderExtraEmails" TEXT[] DEFAULT ARRAY[]::TEXT[];

