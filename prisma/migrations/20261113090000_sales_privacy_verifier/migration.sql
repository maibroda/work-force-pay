-- Sales privacy review fix F-04 (docs/crm/09b-security-review.md): a data request now records WHO (by user id) checked the person's identity, so the person who erases can be
-- told apart from the person who checked. One nullable column; nothing existing is changed (earlier requests keep it empty, and an empty value never blocks an erasure).
-- To reverse, run down.sql in this folder (Prisma runs only migration.sql).
ALTER TABLE "CrmDataRequest" ADD COLUMN "verifiedByUserId" TEXT;
