-- Reverses migration.sql. Which client owns a structure, and which structures are role structures under a client structure (and for which category), is lost: every structure becomes company-wide and top-level again. The structures themselves, their components and every rate card are NOT touched, but a rate card that pointed at a client's role structure would then be usable on any client's contract. Take a copy of these three columns first if they have been used for real.
ALTER TABLE "SalaryStructure" DROP CONSTRAINT "SalaryStructure_categoryId_fkey";
ALTER TABLE "SalaryStructure" DROP CONSTRAINT "SalaryStructure_parentId_fkey";
ALTER TABLE "SalaryStructure" DROP CONSTRAINT "SalaryStructure_clientId_fkey";
DROP INDEX "SalaryStructure_parentId_categoryId_idx";
DROP INDEX "SalaryStructure_organizationId_clientId_idx";
ALTER TABLE "SalaryStructure" DROP COLUMN "categoryId", DROP COLUMN "parentId", DROP COLUMN "clientId";
