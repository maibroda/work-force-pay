-- Reverses 20261220090000_hr_enquiries: removes the HR enquiry tables, their enums and the first-response setting.
-- Destructive for any enquiry already raised (the questions and replies are deleted): take a backup first if the feature has been used.
DROP TABLE "HrEnquiryMessage";
DROP TABLE "HrEnquiry";
DROP TYPE "HrEnquiryStatus";
DROP TYPE "HrEnquiryCategory";
ALTER TABLE "HrPolicy" DROP COLUMN "enquiryResponseDays";
