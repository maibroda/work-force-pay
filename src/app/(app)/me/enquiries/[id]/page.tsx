import { notFound, redirect } from "next/navigation";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { BusinessError } from "@/server/services/_base";
import { getEnquiry } from "@/server/services/hr-enquiries";
import { PageHeader } from "@/components/page";
import { EnquiryThread } from "@/components/enquiry-thread";
import { closeEnquiryAction, replyEnquiryAction } from "@/app/actions/hr-enquiries";

export default async function MyEnquiryPage({ params }: { params: Promise<{ id: string }> }) {
  // open to any signed-in person, then the record decides: only the employee who asked it (and HR, on its own page) can read it
  const ctx = await requirePage();
  const { id } = await params;
  // HR reads an enquiry on its own page (where the read is logged and the case route is offered)
  if (can(ctx.role, "enquiry.respond")) redirect(`/hr/enquiries/${id}`);
  const q = await getEnquiry(ctx, id).catch((e) => {
    if (e instanceof BusinessError) return null;
    throw e;
  });
  // this is the employee's own page: HR reads an enquiry on its own page, so a read here by anyone but the asker is not shown
  if (!q || q.employeeId !== ctx.employeeId) notFound();
  return (
    <>
      <PageHeader title="My enquiry" crumbs={[{ href: "/me/enquiries", label: "Ask HR" }]} />
      <EnquiryThread q={q} hrSide={false} reply={replyEnquiryAction.bind(null, id)} close={closeEnquiryAction.bind(null, id)} />
    </>
  );
}
