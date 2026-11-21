-- Reverses 20270101090000_sick_spells: removes the sick spells (paid sick leave for staff paid by the hour) and the paid sick days a year setting.
-- Every sick spell recorded is LOST (the certificates, which are documents, are not touched), so run this only on a database that is being rolled back as a whole, and after a backup if any sick spell has been recorded.
-- Nothing that existed before is touched (the migration only added a column with a default of 0 and a table).
DROP TABLE "SickSpell";
ALTER TABLE "LeavePolicy" DROP COLUMN "sickDaysPerYear";
