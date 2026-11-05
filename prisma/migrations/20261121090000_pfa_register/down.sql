-- Reverses migration.sql. The company PFA lists (including any PenCom numbers and any PFA switched off) are lost; employees keep their pfa, which is stored on the employee, so nothing on a payroll record or schedule changes. Take a copy of the table first if the lists have been edited.
DROP TABLE "PensionFundAdministrator";
