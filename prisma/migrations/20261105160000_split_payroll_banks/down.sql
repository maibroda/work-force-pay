-- Reverses migration.sql. Who is assigned to which paying bank, and the bank recorded on each payment, are lost; every other table and the files already made are untouched.
ALTER TABLE "PaymentTransaction" DROP CONSTRAINT "PaymentTransaction_payingBankId_fkey";
ALTER TABLE "Employee" DROP CONSTRAINT "Employee_payingBankId_fkey";
ALTER TABLE "PaymentTransaction" DROP COLUMN "payingBankId";
ALTER TABLE "Employee" DROP COLUMN "payingBankId";
