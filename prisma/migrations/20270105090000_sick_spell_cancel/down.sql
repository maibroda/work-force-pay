-- Reverses 20270105090000_sick_spell_cancel: removes who cancelled a spell of sickness, when, the reason, and the payroll run that raised the overpayment finding.
-- Those details are LOST (a cancelled spell stays CANCELLED, but who cancelled it and why is gone, and a finding already raised could be raised again by the next payroll): run this only on a database that is being rolled back as a whole, after a backup if any approved spell has been cancelled.
-- Nothing that existed before is touched (the migration only added nullable columns).
ALTER TABLE "SickSpell" DROP COLUMN "overpaymentRunId",
DROP COLUMN "cancellationNote",
DROP COLUMN "cancelledAt",
DROP COLUMN "cancelledByUserId",
DROP COLUMN "cancelledBy";
