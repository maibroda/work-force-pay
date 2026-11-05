-- Reverses migration.sql. Every proposed, approved, rejected or withdrawn pay-rate proposal is lost. The pay rates that approvals made are in EmployeePayRate and are NOT touched. Take a copy of the table first if proposals have been used for real.
DROP TABLE "PayRateProposal";
DROP TYPE "PayRateProposalStatus";
