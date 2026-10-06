import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { getBreach } from "@/server/services/breaches";
import { ASSESSMENT_LABELS, DATA_CATEGORIES, describeHours, needsIndividuals, needsRegulator, NOTIFY_STATE_LABELS } from "@/lib/breaches";
import { fmtDate, iso } from "@/lib/dates";
import { FormPanel, KV, PageHeader, Section } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { SmartForm } from "@/components/smart-form";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { addBreachNoteAction, assessBreachAction, closeBreachAction, notifyIndividualsAction, notifyRegulatorAction, updateBreachDetailsAction } from "@/app/actions/breaches";

const tone = { OVERDUE: "red", DUE_SOON: "amber", RUNNING: "amber", LATE: "red", ON_TIME: "green", NOT_REQUIRED: "gray" } as const;
const stamp = (d: Date) => `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} UTC`;

export default async function BreachPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("hr.view");
  const { id } = await params;
  const b = await getBreach(ctx, id);
  if (!b) notFound();
  const manage = can(ctx.role, "hr.manage");
  const approve = can(ctx.role, "hr.approve");
  const open = b.status === "OPEN";
  const today = iso(new Date());
  return (
    <>
      <PageHeader
        title={`${b.incidentNumber} — ${b.title}`}
        crumbs={[{ href: "/hr/breaches", label: "Data breaches" }]}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={b.status} />
            <Badge tone={tone[b.state]}>{NOTIFY_STATE_LABELS[b.state]}</Badge>
            {open && (b.state === "RUNNING" || b.state === "DUE_SOON" || b.state === "OVERDUE") && <span>{b.hoursLeft < 0 ? `${describeHours(b.hoursLeft)} past the deadline` : `${describeHours(b.hoursLeft)} left to tell the regulator`}</span>}
          </span>
        }
        actions={
          open && approve ? (
            <ActionButton action={closeBreachAction.bind(null, b.id)} reason reasonPlaceholder="Closing note (optional)" variant="success">
              Close breach
            </ActionButton>
          ) : undefined
        }
      />

      {!b.contact.named && (
        <div className="mb-5 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <b>Nobody is named as the data protection contact.</b> Set one, the regulator details and your breach procedure under Settings → HR &amp; Lifecycle Policy → Data protection contact, so that whoever picks up a breach out of hours knows who to call.
        </div>
      )}
      <Section title="Who to contact and the procedure">
        <KV
          cols={2}
          items={[
            ["Data protection contact", b.contact.named ? [b.contact.name, b.contact.email, b.contact.phone].filter(Boolean).join(" · ") : "not named"],
            ["Regulator", b.regulator.contact ? `${b.regulator.name} — ${b.regulator.contact}` : b.regulator.name],
          ]}
        />
        {b.runbook && (
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-primary">Our breach procedure</summary>
            <p className="mt-2 whitespace-pre-line">{b.runbook}</p>
          </details>
        )}
      </Section>

      <Section title="What happened">
        <p className="mb-4 whitespace-pre-line text-sm">{b.description}</p>
        <KV
          cols={4}
          items={[
            ["Company became aware", stamp(b.discoveredAt)],
            ["Regulator deadline", `${stamp(b.deadline)} (${b.hours} hours)`],
            ["Happened on", b.occurredOn ? fmtDate(b.occurredOn) : "not known"],
            ["Logged by", b.reportedBy],
            ["Data involved", b.dataCategories.length ? b.dataCategories.join(", ") : "not yet established"],
            ["People affected", b.individualsAffected ?? "not yet known"],
            ["Assessment", <Badge key="a" tone={b.assessment === "UNASSESSED" ? "amber" : b.assessment === "NO_RISK" ? "gray" : "red"}>{ASSESSMENT_LABELS[b.assessment]}</Badge>],
            ["Assessed by", b.assessedBy ? `${b.assessedBy}, ${fmtDate(b.assessedAt)}` : "—"],
          ]}
        />
        {b.assessmentNote && <p className="mt-3 text-sm text-muted-foreground">Why: {b.assessmentNote}</p>}
      </Section>

      <Section title="Containment, cause and fix">
        <KV
          cols={2}
          items={[
            ["Contained", b.containedAt ? `${stamp(b.containedAt)} — ${b.containmentNote}` : "not yet"],
            ["Cause", b.rootCause ?? "not yet recorded"],
            ["What stops it recurring", b.remediation ?? "not yet recorded"],
            ["Regulator told", b.ndpcNotifiedAt ? `${stamp(b.ndpcNotifiedAt)}${b.ndpcReference ? ` (ref ${b.ndpcReference})` : ""}${b.lateReason ? ` — late: ${b.lateReason}` : ""}` : needsRegulator(b.assessment) ? "not yet" : "not required"],
            ["People affected told", b.individualsNotifiedAt ? `${stamp(b.individualsNotifiedAt)} — ${b.individualsNote}` : needsIndividuals(b.assessment) ? "not yet" : "not required"],
            ["Closed", b.closedAt ? `${fmtDate(b.closedAt)} by ${b.closedBy}` : "open"],
          ]}
        />
      </Section>

      {open && manage && (
        <FormPanel title="Update the details">
          <SmartForm
            columns={2}
            submitLabel="Save"
            resetOnSuccess={false}
            action={updateBreachDetailsAction.bind(null, b.id)}
            fields={[
              { name: "individualsAffected", label: "People affected (best estimate)", type: "number", min: 0, defaultValue: b.individualsAffected ?? undefined },
              { name: "containmentNote", label: "How it was contained", type: "textarea", defaultValue: b.containmentNote ?? undefined, help: "Access removed, password reset, device wiped, recipient asked to delete…" },
              { name: "containedDate", label: "Contained on", type: "date", defaultValue: b.containedAt ? iso(b.containedAt) : today },
              { name: "containedTime", label: "At (hours:minutes, optional)" },
              { name: "rootCause", label: "Cause", type: "textarea", defaultValue: b.rootCause ?? undefined },
              { name: "remediation", label: "What stops it happening again", type: "textarea", defaultValue: b.remediation ?? undefined },
              ...DATA_CATEGORIES.map((c, i) => ({ name: `cat_${i}`, label: c, type: "checkbox" as const, defaultValue: b.dataCategories.includes(c) })),
            ]}
          />
        </FormPanel>
      )}

      {open && approve && (
        <FormPanel title={b.assessment === "UNASSESSED" ? "Assess the risk (needed now)" : "Change the assessment"} open={b.assessment === "UNASSESSED"}>
          <SmartForm
            columns={2}
            submitLabel="Record assessment"
            resetOnSuccess={false}
            action={assessBreachAction.bind(null, b.id)}
            fields={[
              { name: "assessment", label: "Likely harm to the people affected", type: "select", required: true, defaultValue: b.assessment === "UNASSESSED" ? undefined : b.assessment, options: (["NO_RISK", "RISK", "HIGH_RISK"] as const).map((v) => ({ value: v, label: ASSESSMENT_LABELS[v] })), help: "Identity theft, fraud, financial loss, distress, physical safety. A risk means the regulator must be told; high risk means the people affected too." },
              { name: "note", label: "Why you reached that view", type: "textarea", required: true, defaultValue: b.assessmentNote ?? undefined },
            ]}
          />
        </FormPanel>
      )}

      {open && approve && needsRegulator(b.assessment) && b.assessment !== "UNASSESSED" && !b.ndpcNotifiedAt && (
        <FormPanel title="Record that the regulator was told" open>
          <SmartForm
            columns={2}
            submitLabel="Record"
            action={notifyRegulatorAction.bind(null, b.id)}
            fields={[
              { name: "notifiedDate", label: "Told on", type: "date", required: true, defaultValue: today },
              { name: "notifiedTime", label: "At (hours:minutes, optional)" },
              { name: "reference", label: "Regulator's reference", help: "From their acknowledgement." },
              { name: "lateReason", label: "If after the deadline: why", type: "textarea", help: `Required when it is later than ${stamp(b.deadline)}.` },
            ]}
          />
          <details className="mt-4 text-sm">
            <summary className="cursor-pointer text-primary">Facts for the notice</summary>
            <pre className="mt-2 whitespace-pre-wrap rounded border bg-muted/40 p-3 text-xs">{b.summary}</pre>
          </details>
        </FormPanel>
      )}

      {open && approve && needsIndividuals(b.assessment) && !b.individualsNotifiedAt && (
        <FormPanel title="Record that the people affected were told" open>
          <SmartForm
            columns={2}
            submitLabel="Record"
            action={notifyIndividualsAction.bind(null, b.id)}
            fields={[
              { name: "notifiedDate", label: "Told on", type: "date", required: true, defaultValue: today },
              { name: "notifiedTime", label: "At (hours:minutes, optional)" },
              { name: "note", label: "How, and what they were told", type: "textarea", required: true, span: 2 },
            ]}
          />
        </FormPanel>
      )}

      <Section title="Timeline" flush>
        <ul className="divide-y text-sm">
          {b.updates.map((u) => (
            <li key={u.id} className="px-4 py-2">
              <span className="font-mono text-xs text-muted-foreground">{stamp(u.createdAt)}</span> · {u.author}
              <div className="whitespace-pre-line">{u.note}</div>
            </li>
          ))}
        </ul>
        {open && manage && (
          <div className="border-t p-4">
            <SmartForm columns={1} submitLabel="Add note" action={addBreachNoteAction.bind(null, b.id)} fields={[{ name: "note", label: "Add to the timeline", type: "textarea", required: true }]} />
          </div>
        )}
      </Section>
    </>
  );
}
