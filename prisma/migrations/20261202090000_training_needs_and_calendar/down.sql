-- Reverses migration.sql. EVERY TRAINING PROGRAMME, SESSION, ENROLMENT (WITH ITS ATTENDANCE RESULT) AND TRAINING NEED IS LOST, and the link from a certificate record to the enrolment that created it.
-- The certificate records themselves (EmployeeTraining) and the compliance view are untouched: a certificate created by an attendance stays as a certificate. The audit log keeps its TRAINING_* entries.
-- Take a copy of the four tables first if they have been used for real.
ALTER TABLE "EmployeeTraining" DROP COLUMN "enrolmentId";
DROP TABLE "TrainingNeed";
DROP TABLE "TrainingEnrolment";
DROP TABLE "TrainingSession";
DROP TABLE "TrainingProgramme";
DROP TYPE "TrainingPriority";
DROP TYPE "TrainingNeedStatus";
DROP TYPE "TrainingNeedSource";
DROP TYPE "TrainingAttendance";
DROP TYPE "TrainingSessionStatus";
