-- Splitting one payroll across paying banks: each employee may name the paying bank their salary is paid from, and each payment records the bank it was made for
-- (fixed when the payment batches are made). Two nullable columns; nothing existing is rewritten, and an empty value means the organization's default paying bank.
-- To reverse, run down.sql in this folder (Prisma runs only migration.sql).

ALTER TABLE "Employee" ADD COLUMN "payingBankId" TEXT;
ALTER TABLE "PaymentTransaction" ADD COLUMN "payingBankId" TEXT;

ALTER TABLE "Employee" ADD CONSTRAINT "Employee_payingBankId_fkey" FOREIGN KEY ("payingBankId") REFERENCES "PayingBank"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_payingBankId_fkey" FOREIGN KEY ("payingBankId") REFERENCES "PayingBank"("id") ON DELETE SET NULL ON UPDATE CASCADE;
