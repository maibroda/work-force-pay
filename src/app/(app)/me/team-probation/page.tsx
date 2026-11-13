import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { getHrPolicy } from "@/server/services/hr-policy";
import { teamProbations } from "@/server/services/probation-workflow";
import { NOTE_MIN, RECOMMENDATION_LABELS, RECOMMENDATIONS } from "@/lib/probation-workflow";
import { fmtDate } from "@/lib/dates";
import { Empty, FormPanel, PageHeader, Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { recommendProbationAction } from "@/app/actions/probation-workflow";

/** My Workspace > My team's probation: recommend for the people who report to you, from the alert window before their probation ends. HR sees the people with no reporting manager too. */
export default async function TeamProbationPage() {
  const ctx = await requirePage("probation.recommend");
  const policy = await getHrPolicy(ctx.orgId);
  const rows = await teamProbations(ctx);
  return (
    <>
      <PageHeader
        title="My team's probation"
        description={`Recommend whether each person's probation should be confirmed, extended or not confirmed, with your reasons (at least ${NOTE_MIN} characters). From ${policy.probationAlertDays} days before the end date. HR then reviews it and an independent decider makes the decision: you do not decide, and nothing happens to the employee because of your recommendation alone.`}
      />
      {!policy.probationWorkflow ? (
        <Section title="Not switched on">
          <p className="text-sm text-muted-foreground">Your company has not switched on the probation workflow (HR policy). Until it does, HR decides probation as before.</p>
        </Section>
      ) : rows.length === 0 ? (
        <Section title="Nobody to recommend on">
          <Empty>No probation of your direct reports is inside the window.</Empty>
        </Section>
      ) : (
        rows.map((r) => (
          <Section key={r.contractId} title={`${r.employeeNumber} — ${r.name}`} description={`Probation of ${r.months} month(s) ends ${fmtDate(r.probationEndDate)}.`}>
            {r.openReview ? (
              <p className="text-sm">
                <Badge tone="blue">{r.openReview.status === "RECOMMENDED" ? "Awaiting HR review" : "With the decider"}</Badge> A recommendation is already in progress.{" "}
                <Link className="text-primary underline" href={`/hr/contracts/${r.contractId}`}>
                  Open the contract
                </Link>
              </p>
            ) : (
              <FormPanel title="Make a recommendation">
                <SmartForm
                  columns={3}
                  submitLabel="Record the recommendation"
                  action={recommendProbationAction.bind(null, r.contractId)}
                  fields={[
                    { name: "recommendation", label: "Recommendation", type: "select", required: true, options: RECOMMENDATIONS.map((x) => ({ value: x, label: RECOMMENDATION_LABELS[x] })) },
                    { name: "months", label: "If extending: months (1 to 12)", type: "number", min: 1, max: 12 },
                    { name: "note", label: "Your reasons", type: "textarea", required: true, span: 3 },
                  ]}
                />
              </FormPanel>
            )}
          </Section>
        ))
      )}
    </>
  );
}
