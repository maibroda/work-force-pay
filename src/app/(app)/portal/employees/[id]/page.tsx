import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { PageHeader, Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { requestEmployeeChangeAction } from "@/app/actions/client-queries";

export default async function PortalEmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("portal.changes");
  const { id } = await params;
  const e = await db.employee.findFirst({ where: { id, organizationId: ctx.orgId }, select: { id: true, employeeNumber: true, firstName: true, lastName: true } });
  if (!e) notFound();
  const reason = { name: "reason", label: "Why is it changing?", required: true, span: 3, placeholder: "e.g. The employee has moved to a new bank" } as const;
  return (
    <>
      <PageHeader title={`${e.employeeNumber} ${e.firstName} ${e.lastName}`} crumbs={[{ href: "/portal/employees", label: "Your employees" }]} description="Each request goes to the bureau, who check it and approve it before anything changes." />
      <Section title="Bank details">
        <SmartForm
          columns={3}
          submitLabel="Ask for this change"
          resetOnSuccess
          action={requestEmployeeChangeAction.bind(null, e.id, "BANK")}
          fields={[
            { name: "bankName", label: "Bank", required: true },
            { name: "accountNumber", label: "Account number (10 digits)", required: true, pattern: "^[0-9]{10}$", patternMessage: "10 digits" },
            { name: "accountName", label: "Account name", required: true },
            reason,
          ]}
        />
      </Section>
      <Section title="Tax details">
        <SmartForm columns={3} submitLabel="Ask for this change" resetOnSuccess action={requestEmployeeChangeAction.bind(null, e.id, "TAX")} fields={[{ name: "taxId", label: "Tax ID" }, { name: "annualRent", label: "Annual rent (₦, for rent relief)", type: "number", min: 0 }, reason]} />
      </Section>
      <Section title="Pension details">
        <SmartForm columns={3} submitLabel="Ask for this change" resetOnSuccess action={requestEmployeeChangeAction.bind(null, e.id, "PENSION")} fields={[{ name: "pensionPin", label: "Pension PIN" }, { name: "pfa", label: "Pension fund administrator" }, reason]} />
      </Section>
    </>
  );
}
