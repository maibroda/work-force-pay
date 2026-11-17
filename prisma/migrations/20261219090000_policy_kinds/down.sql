-- Reverses 20261219090000_policy_kinds. Drops the kind, the acknowledgement switch and the review date from company policies, and the enum.
-- Every handbook and procedure becomes an ordinary policy that employees must acknowledge, and review dates are lost. Take a backup first if handbooks or procedures have been added.

ALTER TABLE "CompanyPolicy" DROP COLUMN "acknowledgementRequired",
DROP COLUMN "kind",
DROP COLUMN "reviewDueOn";

DROP TYPE "PolicyKind";
