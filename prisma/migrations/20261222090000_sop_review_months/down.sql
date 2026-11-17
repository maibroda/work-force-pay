-- Reverses 20261222090000_sop_review_months: removes the company setting for how many months a procedure (SOP) review date may be ahead.
-- Existing procedure review dates are untouched; the rule that a procedure needs one is in the application, not the database.

ALTER TABLE "HrPolicy" DROP COLUMN "sopReviewMonths";
