-- Reverses migration.sql. EVERY RECOGNITION AWARD TYPE AND AWARD (WITH ITS CITATION, DECISION AND ANNOUNCEMENT ANSWER) IS LOST, and the company's long-service years.
-- Postgres cannot remove a value from an enum, so the case type is recreated without WELFARE. Any WELFARE case is KEPT, converted to the type OTHER (it stays confidential, so it is
-- no more visible than before); its welfare kind is lost. The audit log keeps its entries. Take a copy of the two award tables first if they have been used for real.
UPDATE "RelationsCase" SET "type" = 'OTHER', "confidential" = true WHERE "type" = 'WELFARE';
ALTER TABLE "RelationsCase" DROP COLUMN "welfareKind";
ALTER TYPE "RelationsCaseType" RENAME TO "RelationsCaseType_old";
CREATE TYPE "RelationsCaseType" AS ENUM ('GRIEVANCE', 'MISCONDUCT', 'HARASSMENT', 'WHISTLEBLOWING', 'COUNSELLING', 'MEDIATION', 'OTHER');
ALTER TABLE "RelationsCase" ALTER COLUMN "type" TYPE "RelationsCaseType" USING ("type"::text::"RelationsCaseType");
DROP TYPE "RelationsCaseType_old";
DROP TABLE "RecognitionAward";
DROP TABLE "RecognitionAwardType";
ALTER TABLE "HrPolicy" DROP COLUMN "longServiceYears";
DROP TYPE "RecognitionStatus";
DROP TYPE "WelfareKind";
