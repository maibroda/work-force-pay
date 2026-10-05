import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { hrOverview } from "@/server/services/hr-overview";
import { PageHeader, Section, Stat, StatGrid } from "@/components/page";

function L({
  href,
  label,
  value,
  sub,
  tone,
}: {
  href: string;
  label: string;
  value: number | string;
  sub?: string;
  tone?: "red" | "amber" | "green";
}) {
  return (
    <Link href={href} className="block rounded-lg transition-shadow hover:shadow-md">
      <Stat label={label} value={value} sub={sub} tone={value ? tone : undefined} />
    </Link>
  );
}

export default async function HrOverviewPage() {
  const ctx = await requirePage("hr.view");
  const o = await hrOverview(ctx);
  return (
    <>
      <PageHeader
        title="HR lifecycle overview"
        description="Everything that needs attention across hiring, onboarding, contracts, employee relations and exits — hire to retire in one place."
      />

      <Section title="Recruitment" description="Requisition → candidates → interviews → vetting → offer → hire.">
        <StatGrid>
          <L href="/hr/requisitions?status=PENDING_APPROVAL" label="Requisitions awaiting approval" value={o.recruitment.requisitionsPending} tone="amber" />
          <L href="/hr/requisitions?status=APPROVED" label="Open requisitions" value={o.recruitment.requisitionsOpen} />
          <L href="/hr/candidates" label="Candidates in the pipeline" value={o.recruitment.inPipeline} />
          <L href="/hr/candidates?stage=OFFER" label="Offers outstanding" value={o.recruitment.offersPending} tone="amber" sub={`${o.recruitment.hired} hired to date`} />
        </StatGrid>
      </Section>

      <Section title="Onboarding & contracts" description="Settling new joiners in, and keeping every employee's terms current.">
        <StatGrid cols={5}>
          <L href="/hr/onboarding" label="Joiners with open onboarding steps" value={o.onboarding.employeesIncomplete} tone="amber" />
          <L href="/hr/onboarding" label="Overdue onboarding steps" value={o.onboarding.overdueTasks} tone="red" />
          <L href="/hr/contracts?tab=alerts" label="Contracts ending soon" value={o.contracts.endingSoon} tone="amber" sub={`${o.contracts.pastEnd} already past their end date`} />
          <L href="/hr/contracts?tab=alerts" label="Probation reviews due" value={o.contracts.probationDue} tone="amber" sub={`${o.contracts.probationOverdue} overdue`} />
          <L href="/hr/contracts?tab=alerts" label="Staff with no contract on file" value={o.contracts.withoutContract} tone="red" />
        </StatGrid>
      </Section>

      <Section title="Employee relations" description="Grievances, investigations and sanctions.">
        <StatGrid cols={3}>
          <L href="/hr/relations" label="Open cases" value={o.relations.open} />
          <L href="/hr/relations?overdue=1" label="Past their resolution target" value={o.relations.overdue} tone="red" />
          <Stat label="Average time to resolve (12 months)" value={o.relations.avgResolutionDays === null ? "—" : `${o.relations.avgResolutionDays} days`} />
        </StatGrid>
      </Section>

      <Section title="Exits & end-of-service" description="Offboarding, clearance and what the leaver is owed.">
        <StatGrid cols={5}>
          <L href="/hr/exits" label="Exits awaiting approval" value={o.exits.pendingApproval} tone="amber" />
          <L href="/hr/exits" label="Clearance in progress" value={o.exits.clearanceInProgress} tone="amber" />
          <L href="/payroll/settlements?status=DRAFT" label="Settlements in draft" value={o.settlements.draft} />
          <L href="/payroll/settlements?status=PENDING_APPROVAL" label="Settlements awaiting approval" value={o.settlements.pendingApproval} tone="amber" />
          <L href="/payroll/settlements?status=APPROVED" label="Approved, not yet in payroll" value={o.settlements.approvedNotReleased} tone="amber" />
        </StatGrid>
      </Section>

      <Section title="Compliance">
        <StatGrid cols={3}>
          <L href="/reports/employee-documents" label="Documents expired or expiring in 60 days" value={o.expiringDocuments} tone="red" />
        </StatGrid>
      </Section>
    </>
  );
}
