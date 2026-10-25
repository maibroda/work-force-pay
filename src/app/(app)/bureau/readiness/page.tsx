import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { launchChecklist } from "@/server/services/launch-readiness";
import { inBureau } from "@/server/services/rule-library";
import { fmtDate } from "@/lib/dates";
import { PageHeader, Section, Stat, StatGrid } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { SmartForm } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { confirmLaunchCheckAction, sendTestEmailAction, withdrawLaunchCheckAction } from "@/app/actions/launch-readiness";

const TONE = { DONE: "green", TODO: "red", ATTENTION: "amber" } as const;
const WORDS = { DONE: "Done", TODO: "To do", ATTENTION: "Needs attention" } as const;

export default async function ReadinessPage() {
  const ctx = await requirePage("bureau.view");
  if (!(await inBureau(ctx)))
    return <PageHeader title="Launch checklist" description="This organization is not set up as a payroll bureau." />;
  const c = await launchChecklist(ctx);
  const manage = can(ctx.role, "bureau.manage");
  return (
    <>
      <PageHeader
        title={`${c.bureau} — launch checklist`}
        description="What has to be true before real clients' payroll runs through the app. The app judges what it can see for itself; the rest is confirmed by a bureau manager, saying what they did."
      />
      <StatGrid cols={3}>
        <Stat label="Done" value={`${c.done} of ${c.total}`} tone={c.ready ? "green" : "amber"} />
        <Stat label="To do" value={c.items.filter((i) => i.status === "TODO").length} tone={c.items.some((i) => i.status === "TODO") ? "red" : "green"} />
        <Stat label="Needs attention" value={c.items.filter((i) => i.status === "ATTENTION").length} tone={c.items.some((i) => i.status === "ATTENTION") ? "amber" : "green"} />
      </StatGrid>
      {c.items.map((i) => (
        <Section
          key={i.key}
          title={i.title}
          actions={<Badge tone={TONE[i.status]}>{WORDS[i.status]}</Badge>}
          description={i.manual ? "Confirmed by a person" : "Checked by the app"}
        >
          <ul className="space-y-1 text-sm">
            {i.evidence.map((e, n) => (
              <li key={n} className={i.status === "DONE" ? "text-muted-foreground" : ""}>
                {e}
              </li>
            ))}
          </ul>
          {i.how && i.status !== "DONE" && (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-primary">What to do</summary>
              <p className="mt-2 text-muted-foreground">{i.how}</p>
            </details>
          )}
          {i.points && (
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer text-primary">Points for HR and Finance to settle when they verify</summary>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                {i.points.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </details>
          )}
          {i.key === "EMAIL" && manage && (
            <div className="mt-3">
              <ActionButton action={sendTestEmailAction} variant="outline">
                Send me a test email
              </ActionButton>
            </div>
          )}
          {i.manual && manage && (
            <div className="mt-3">
              {i.confirmed ? (
                <ActionButton action={withdrawLaunchCheckAction.bind(null, i.key)} variant="outline" reason reasonPlaceholder="Why is this no longer confirmed?">
                  Withdraw confirmation
                </ActionButton>
              ) : (
                <SmartForm
                  columns={1}
                  submitLabel="Confirm"
                  resetOnSuccess
                  action={confirmLaunchCheckAction.bind(null, i.key)}
                  fields={[{ name: "note", label: "What did you do, and what did you find?", type: "textarea", required: true }]}
                />
              )}
            </div>
          )}
          {i.confirmed && <p className="mt-2 text-xs text-muted-foreground">Confirmed {fmtDate(i.confirmed.at)}.</p>}
        </Section>
      ))}
    </>
  );
}
