import { redirect } from "next/navigation";
export default function LockPage() {
  redirect("/payroll/runs?status=APPROVED");
}
