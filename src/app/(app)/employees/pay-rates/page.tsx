import { requirePage } from "@/lib/auth/session";
import { listPayRateProposals } from "@/server/services/pay-rate-proposals";
import { PageHeader, Section } from "@/components/page";
import { PayRateProposalsTable } from "@/components/pay-rate-proposals-table";

export default async function PayRateApprovalsPage() {
  const ctx = await requirePage("override.manage");
  const [pending, decided] = await Promise.all([listPayRateProposals(ctx, { status: "PENDING" }), listPayRateProposals(ctx, {})]);
  return (
    <>
      <PageHeader
        title="Pay rate approvals"
        description="A personal monthly gross (for staff who are not paid from a client contract rate) is proposed by HR or payroll and approved here by a payroll manager, a second person, before it becomes the employee's pay rate. Nobody approves their own proposal or their own pay."
      />
      <Section title={`Waiting for approval (${pending.length})`} flush>
        <PayRateProposalsTable ctx={ctx} rows={pending} />
      </Section>
      <Section title="All proposals, newest first" flush>
        <PayRateProposalsTable ctx={ctx} rows={decided.slice(0, 100)} />
      </Section>
    </>
  );
}
