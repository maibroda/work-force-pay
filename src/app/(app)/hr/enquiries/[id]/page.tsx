import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth/session";
import { BusinessError } from "@/server/services/_base";
import { getEnquiry } from "@/server/services/hr-enquiries";
import { enumOptions } from "@/server/options";
import { WELFARE_KIND_LABELS, WELFARE_KINDS } from "@/lib/welfare";
import { FormPanel, PageHeader } from "@/components/page";
import { EnquiryThread } from "@/components/enquiry-thread";
import { SmartForm } from "@/components/smart-form";
import { closeEnquiryAction, moveEnquiryToCaseAction, replyEnquiryAction } from "@/app/actions/hr-enquiries";

export default async function HrEnquiryPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("enquiry.respond");
  const { id } = await params;
  // opening it is what is logged (by the enquiry's number, never by the employee)
  const q = await getEnquiry(ctx, id).catch((e) => {
    if (e instanceof BusinessError) return null;
    throw e;
  });
  if (!q) notFound();
  const open = q.status !== "CLOSED";
  return (
    <>
      <PageHeader title="HR enquiry" crumbs={[{ href: "/hr/enquiries", label: "HR enquiries" }]} description={`From ${q.employee.employeeNumber} ${q.employee.firstName} ${q.employee.lastName}. Opening this enquiry has been recorded.`} />
      <EnquiryThread q={q} hrSide canClose={Boolean(q.firstResponseAt)} reply={replyEnquiryAction.bind(null, id)} close={closeEnquiryAction.bind(null, id)} />
      {open && (
        <FormPanel title="This is really a grievance, harassment, whistleblowing or a welfare concern">
          <p className="mb-3 text-xs text-muted-foreground">
            Do not answer it here. Open an Employee relations case for this employee through the normal process: you write the case&apos;s summary and description yourself, the conversation is not copied, and the employee is told it has
            been moved (without the case number). This enquiry is then closed.
          </p>
          <SmartForm
            columns={2}
            submitLabel="Move into a case"
            action={moveEnquiryToCaseAction.bind(null, id)}
            fields={[
              { name: "type", label: "Kind of case", type: "select", required: true, options: enumOptions(["GRIEVANCE", "HARASSMENT", "WHISTLEBLOWING", "WELFARE"]) },
              { name: "welfareKind", label: "If welfare support: what kind?", type: "select", options: WELFARE_KINDS.map((k) => ({ value: k, label: WELFARE_KIND_LABELS[k] })) },
              { name: "severity", label: "How serious is it?", type: "select", defaultValue: "MEDIUM", options: enumOptions(["LOW", "MEDIUM", "HIGH"]) },
              { name: "summary", label: "Summary for the case", required: true, span: 2 },
              { name: "description", label: "What the case is about (in your own words)", type: "textarea", required: true, span: 2 },
            ]}
          />
        </FormPanel>
      )}
    </>
  );
}
