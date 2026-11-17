import { requirePage } from "@/lib/auth/session";
import { myPolicies } from "@/server/services/policies";
import { ACK_LABELS, POLICY_KIND_LABELS, matchesQuery } from "@/lib/policies";
import { fmtDate } from "@/lib/dates";
import { Empty, PageHeader, Section } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { Badge } from "@/components/ui/badge";
import { acknowledgeAction } from "@/app/actions/policies";

export default async function MyPoliciesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await requirePage();
  const { q } = await searchParams;
  const items = await myPolicies(ctx);
  // what must be acknowledged, exactly as before; what is only to be read (the handbook, procedures, and any item HR has not asked people to sign); and what has been acknowledged
  const todo = items.filter((i) => i.state === "PENDING" || i.state === "OVERDUE");
  const done = items.filter((i) => i.state === "ACKNOWLEDGED");
  const toRead = items.filter((i) => i.state === "NOT_REQUIRED" && matchesQuery(i.policy, q));
  const readable = items.filter((i) => i.state === "NOT_REQUIRED");
  return (
    <>
      <PageHeader
        title="My policies"
        description="Company policies that apply to you: read each one, then acknowledge that you've read and understood it. When a policy changes you'll be asked again for the new version. The handbook and procedures are there to read; nobody asks you to sign them."
      />
      {!ctx.employeeId ? (
        <Section title="Not available">
          <p className="text-sm text-muted-foreground">Your login isn&apos;t linked to an employee record yet — ask HR to link it.</p>
        </Section>
      ) : (
        <>
          {todo.length === 0 && (
            <p className="mb-5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
              {items.length ? "You're up to date — there's nothing to acknowledge." : "No policies apply to you yet."}
            </p>
          )}
          {todo.map((i) => (
            <Section
              key={i.policy.id}
              title={`${i.policy.title} (version ${i.version.version})`}
              description={
                <span className="flex flex-wrap items-center gap-2">
                  <Badge tone={i.state === "OVERDUE" ? "red" : "amber"}>{ACK_LABELS[i.state]}</Badge> due {fmtDate(i.due)} · in effect since {fmtDate(i.version.effectiveDate)}
                  {i.version.changeSummary && <span className="text-muted-foreground">— what changed: {i.version.changeSummary}</span>}
                </span>
              }
            >
              {i.policy.summary && <p className="mb-2 text-sm font-medium">{i.policy.summary}</p>}
              {i.version.body && <div className="mb-3 max-h-96 overflow-auto whitespace-pre-line rounded-md border bg-muted/30 p-3 text-sm">{i.version.body}</div>}
              {i.version.documentReference && <p className="mb-3 text-xs text-muted-foreground">Full document: {i.version.documentReference} (ask HR for a copy).</p>}
              <ActionButton action={acknowledgeAction.bind(null, i.policy.id)} confirm={`Confirm you have read and understood “${i.policy.title}”?`}>
                I have read and understood this policy
              </ActionButton>
            </Section>
          ))}
          {readable.length > 0 && (
            <Section title="Handbook & procedures" description="To read whenever you need them. You do not have to acknowledge these.">
              <form method="get" className="mb-4 flex max-w-md gap-2">
                <input name="q" defaultValue={q ?? ""} placeholder="Search by title" aria-label="Search by title" className="w-full rounded border px-3 py-1.5 text-sm" />
                <button type="submit" className="rounded border px-3 py-1.5 text-sm">
                  Search
                </button>
              </form>
              {toRead.length === 0 && <Empty>Nothing matches &ldquo;{q}&rdquo;.</Empty>}
              {toRead.map((i) => (
                <details key={i.policy.id} className="mb-3 rounded-md border">
                  <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium">
                    {i.policy.title} <span className="ml-1 text-[10px] font-normal uppercase text-muted-foreground">{POLICY_KIND_LABELS[i.policy.kind]}</span>
                    {i.policy.summary && <span className="block text-xs font-normal text-muted-foreground">{i.policy.summary}</span>}
                  </summary>
                  <div className="border-t p-3">
                    <p className="mb-2 text-xs text-muted-foreground">
                      Version {i.version.version}, in effect since {fmtDate(i.version.effectiveDate)}
                      {i.version.changeSummary ? ` — what changed: ${i.version.changeSummary}` : ""}
                    </p>
                    {i.version.body && <div className="max-h-96 overflow-auto whitespace-pre-line rounded-md border bg-muted/30 p-3 text-sm">{i.version.body}</div>}
                    {i.version.documentReference && <p className="mt-2 text-xs text-muted-foreground">Full document: {i.version.documentReference} (ask HR for a copy).</p>}
                  </div>
                </details>
              ))}
            </Section>
          )}
          {done.length > 0 && (
            <Section title="Acknowledged" flush>
              <ul className="divide-y text-sm">
                {done.map((i) => (
                  <li key={i.policy.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                    <span>
                      {i.policy.title} <span className="text-xs text-muted-foreground">(version {i.version.version})</span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {fmtDate(i.acknowledgedAt)}
                      {i.method === "RECORDED" ? " · paper sign-off recorded by HR" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </>
      )}
    </>
  );
}
