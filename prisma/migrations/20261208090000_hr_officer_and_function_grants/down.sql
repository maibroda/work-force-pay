-- Reverses 20261208090000_hr_officer_and_function_grants.
-- Postgres cannot remove a value from an enum, so the Role type is rebuilt without HR_OFFICER. Any Delegated HR Officer is first turned into an ordinary
-- EMPLOYEE login that is INACTIVE (it cannot sign in until an administrator reviews it), HR_OFFICER is removed from any company's two-factor role list, and all
-- function grants are dropped with their table. Two columns use the Role type: User.role and HrPolicy.twoFactorRoles (a list of roles).
UPDATE "User" SET "role" = 'EMPLOYEE', "active" = false, "sessionVersion" = "sessionVersion" + 1 WHERE "role" = 'HR_OFFICER';
UPDATE "HrPolicy" SET "twoFactorRoles" = array_remove("twoFactorRoles", 'HR_OFFICER'::"Role");
DROP TABLE "UserFunctionGrant";
ALTER TABLE "User" DROP COLUMN "accessEndsOn", DROP COLUMN "external";
DROP TYPE "HrFunction";
ALTER TYPE "Role" RENAME TO "Role_old";
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'COMPANY_ADMIN', 'HR_ADMIN', 'OPERATIONS', 'PAYROLL_ADMIN', 'FINANCE', 'AUDITOR', 'SUPERVISOR', 'EMPLOYEE', 'CLIENT_APPROVER', 'CLIENT_HR', 'BUSINESS_DEV', 'SALES_REP', 'SALES_MANAGER', 'ACCOUNT_MANAGER');
ALTER TABLE "User" ALTER COLUMN "role" TYPE "Role" USING "role"::text::"Role";
ALTER TABLE "HrPolicy" ALTER COLUMN "twoFactorRoles" DROP DEFAULT;
ALTER TABLE "HrPolicy" ALTER COLUMN "twoFactorRoles" TYPE "Role"[] USING "twoFactorRoles"::text[]::"Role"[];
ALTER TABLE "HrPolicy" ALTER COLUMN "twoFactorRoles" SET DEFAULT ARRAY[]::"Role"[];
DROP TYPE "Role_old";
