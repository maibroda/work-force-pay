import { redirect } from "next/navigation";
export default function ApprovalPage() {
  redirect("/payroll/runs?status=PENDING_APPROVAL");
}
