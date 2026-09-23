import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth/session";
import { getPayslip } from "@/server/services/payroll";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/page";
import { Payslip } from "@/components/payslip";
import { PrintButton } from "@/components/print-button";

export default async function PayslipPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage();
  const { id } = await params;
  const rec = await getPayslip(ctx, id);
  if (!rec) notFound();
  if (ctx.role === "SUPERVISOR") notFound();
  if (ctx.role === "EMPLOYEE" && !["APPROVED", "LOCKED", "PAID"].includes(rec.run.status)) notFound();
  const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.orgId } });
  return (
    <>
      <div className="no-print">
        <PageHeader title={`Payslip — ${rec.employeeNumber}`} actions={<PrintButton />} />
      </div>
      <Payslip rec={rec} orgName={org.name} />
    </>
  );
}
