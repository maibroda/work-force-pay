-- Reverses 20270108090000_payslip_client_names: removes the client and site names kept on each stored hours and extra pay line.
-- The names are LOST (a payslip then shows the current names of the client and the site, so a renamed client would show its new name on an old payslip): run this only on a database that is being rolled back as a whole, after a backup if any payroll has been calculated since.
-- Nothing that existed before is touched (the migration only added nullable columns).
ALTER TABLE "HourlyAllowanceLine" DROP COLUMN "siteName",
DROP COLUMN "clientName";
ALTER TABLE "HourlyPayLine" DROP COLUMN "siteName",
DROP COLUMN "clientName";
