-- Reverses 20270103090000_leave_defaults: puts the defaults for NEW payroll rule versions and NEW leave policies back to 0 (no leave pay for staff paid by the hour, no paid sick days).
-- Nothing stored is changed: the migration only changed what a NEW row gets when it is made without a value, and every existing payroll rule version and leave policy keeps the value it has.
ALTER TABLE "PayrollRule" ALTER COLUMN "hourlyLeavePct" SET DEFAULT 0;
ALTER TABLE "LeavePolicy" ALTER COLUMN "sickDaysPerYear" SET DEFAULT 0;
