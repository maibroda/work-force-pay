import { redirect } from "next/navigation";
import { requirePage } from "@/lib/auth/session";
import { resolveRun } from "@/server/services/reports";
import { PageHeader, Empty } from "@/components/page";

export default async function ControlPage() {
  const ctx = await requirePage("payroll.view");
  const run = await resolveRun(ctx);
  if (run) redirect(`/payroll/runs/${run.id}`);
  return (
    <>
      <PageHeader title="Payroll Control Centre" />
      <Empty>No payroll has been calculated yet. Open a period and run payroll.</Empty>
    </>
  );
}
