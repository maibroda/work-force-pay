import { ActionButton } from "@/components/action-button";
import { rejectInputAction } from "@/app/actions/payroll";
import type { ActionResult } from "@/lib/action-result";

export function ApproveReject({
  kind,
  id,
  approve,
  canApprove,
  status,
}: {
  kind: "overtime" | "deduction" | "arrears" | "otherEarning";
  id: string;
  approve: (r?: string) => Promise<ActionResult>;
  canApprove: boolean;
  status: string;
}) {
  if (!canApprove || status !== "PENDING") return null;
  return (
    <span className="space-x-1">
      <ActionButton action={approve} variant="success">
        Approve
      </ActionButton>
      <ActionButton action={rejectInputAction.bind(null, kind, id)} reason variant="outline">
        Reject
      </ActionButton>
    </span>
  );
}
