import { requirePage } from "@/lib/auth/session";
import { getLeavePolicy } from "@/server/services/leave";
import { PageHeader, Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { updateLeavePolicyAction } from "@/app/actions/leave";

export default async function LeavePolicyPage() {
  const ctx = await requirePage("leave.manage");
  const p = await getLeavePolicy(ctx.orgId);
  return (
    <>
      <PageHeader
        title="Leave policy"
        crumbs={[{ href: "/leave", label: "Leave management" }]}
        description="Applies to every employee. Changes affect new requests and balances going forward; requests already made keep the days they were charged."
      />
      <Section title="Annual leave">
        <SmartForm
          columns={3}
          submitLabel="Save policy"
          resetOnSuccess={false}
          action={updateLeavePolicyAction}
          fields={[
            {
              name: "annualDays",
              label: "Working days per year",
              type: "number",
              required: true,
              min: 1,
              max: 60,
              defaultValue: p.annualDays,
              help: "Entitlement for each leave year.",
            },
            {
              name: "eligibilityMonths",
              label: "Months of service before leave is due",
              type: "number",
              required: true,
              min: 0,
              max: 60,
              defaultValue: p.eligibilityMonths,
              help: "0 makes leave due from the first day. Renews every 12 months after.",
            },
            {
              name: "workingDaysPerWeek",
              label: "Working week",
              type: "select",
              required: true,
              defaultValue: p.workingDaysPerWeek,
              options: [
                { value: "5", label: "5 days (Mon–Fri)" },
                { value: "6", label: "6 days (Mon–Sat)" },
                { value: "7", label: "7 days (every day)" },
              ],
              help: "Which days count against the leave balance.",
            },
          ]}
        />
      </Section>
    </>
  );
}
