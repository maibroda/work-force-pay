-- Reverses migration.sql. Every contract's paid-days basis (and its history), the company's public holidays and their yearly confirmations, and the "unpaid" mark on leave requests are LOST: afterwards every
-- contract is paid on the company's rule and every leave request is paid leave (an approved unpaid request would then no longer reduce pay, so recalculate any open payroll). Take a copy of these tables first if they
-- have been used for real. Payroll records already calculated are NOT touched.
DROP TABLE "HolidayCalendarYear";
DROP TABLE "PublicHoliday";
DROP TABLE "ContractPayBasis";
ALTER TABLE "LeaveRequest" DROP COLUMN "unpaid";
ALTER TABLE "LeavePolicy" DROP COLUMN "unpaidLeaveEnabled";
DROP TYPE "PaidDaysBasis";
