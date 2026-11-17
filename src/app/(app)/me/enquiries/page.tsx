import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { myEnquiries } from "@/server/services/hr-enquiries";
import { ENQUIRY_CATEGORIES, ENQUIRY_CATEGORY_LABELS, ENQUIRY_STATUS_LABELS } from "@/lib/hr-enquiries";
import { fmtDate } from "@/lib/dates";
import { FormPanel, PageHeader, Section, Empty } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { raiseEnquiryAction } from "@/app/actions/hr-enquiries";

export default async function AskHrPage() {
  const ctx = await requirePage("enquiry.raise");
  const rows = await myEnquiries(ctx);
  return (
    <>
      <PageHeader title="Ask HR" description="Ask HR a question about your pay, leave, a letter you need, a policy or your benefits. HR replies here. Only you and the HR administrator can read your enquiries." />
      <p className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <b>Not here:</b> if it is a grievance, harassment, whistleblowing or a welfare concern, please use{" "}
        <Link className="underline" href="/me/grievances">
          My cases and support
        </Link>{" "}
        so it is handled in confidence. A question about your pay is only a question: HR cannot change your pay from here.
      </p>
      {!ctx.employeeId ? (
        <Section title="Not available">
          <p className="text-sm text-muted-foreground">Your login isn&apos;t linked to an employee record yet — ask HR to link it.</p>
        </Section>
      ) : (
        <FormPanel title="Ask a question" open={!rows.length}>
          <SmartForm
            columns={2}
            submitLabel="Send to HR"
            action={raiseEnquiryAction}
            fields={[
              { name: "category", label: "What is it about?", type: "select", required: true, options: ENQUIRY_CATEGORIES.map((c) => ({ value: c, label: ENQUIRY_CATEGORY_LABELS[c] })) },
              { name: "subject", label: "A short title", required: true, span: 2 },
              { name: "body", label: "Your question", type: "textarea", required: true, span: 2 },
            ]}
          />
        </FormPanel>
      )}
      <Section title="My enquiries" flush>
        {rows.length === 0 ? (
          <Empty>You have not asked HR anything yet.</Empty>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Enquiry</TH>
                <TH>About</TH>
                <TH>Title</TH>
                <TH>Raised</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((q) => (
                <TR key={q.id}>
                  <TD className="font-mono text-xs">
                    <Link className="text-primary underline" href={`/me/enquiries/${q.id}`}>
                      {q.number}
                    </Link>
                  </TD>
                  <TD className="text-xs">{ENQUIRY_CATEGORY_LABELS[q.category]}</TD>
                  <TD className="max-w-xs whitespace-normal text-xs">{q.subject}</TD>
                  <TD className="text-xs">{fmtDate(q.createdAt)}</TD>
                  <TD>
                    <Badge tone={q.status === "CLOSED" ? "gray" : q.status === "ANSWERED" ? "blue" : "amber"}>{ENQUIRY_STATUS_LABELS[q.status]}</Badge>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Section>
    </>
  );
}
