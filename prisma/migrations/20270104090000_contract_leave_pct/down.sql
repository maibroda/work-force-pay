-- Reverses 20270104090000_contract_leave_pct: removes the contract rate's own leave percentage for staff paid by the hour.
-- The percentages entered on contract rates are LOST (payroll then uses the company's percentage everywhere); stored pay lines keep the percentage they used.
-- Nothing that existed before is touched (the migration only added a nullable column). Run it only on a database that is being rolled back as a whole, after a backup if any percentage has been entered.
ALTER TABLE "ContractRate" DROP COLUMN "hourlyLeavePct";
