-- Reverses 20261229090000_hourly_pay_pieces: removes the record of which approved pieces of shifts each payroll has paid or credited. Nothing that existed before is touched (the migration only added a table and a type).
-- Every such record is LOST, so run this only on a database that is being rolled back as a whole, and after a backup if any hourly payroll has been calculated. Without it a supplementary payroll could not tell which hours were already paid.
DROP TABLE "HourlyPayPiece";
DROP TYPE "HourlyPieceKind";
