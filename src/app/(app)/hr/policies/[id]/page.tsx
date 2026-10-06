import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { getPolicy } from "@/server/services/policies";
import { options } from "@/server/options";
import { ACK_LABELS } from "@/lib/policies";
import { fmtDate } from "@/lib/dates";
import { fullName } from "@/lib/utils";
import { FormPanel, PageHeader, Section, Stat, StatGrid, Empty } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { SmartForm } from "@/components/smart-form";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { publishVersionAction, recordAcknowledgementAction, setPolicyStatusAction, updatePolicyAction } from "@/app/actions/policies";

const ORDER = { OVERDUE: 0, PENDING: 1, ACKNOWLEDGED: 2 } as const;

export default async function PolicyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePage("hr.view");
  const { id } = await params;
  const sp = await searchParams;
  const data = await getPolicy(ctx, id);
  if (!data) notFound();
  const { policy, current, scheduled, rows, totals, versions } = data;
  const configure = can(ctx.role, "hr.configure");
  const manage = can(ctx.role, "hr.manage");
  const o = configure ? await options(ctx) : null;
  const showAll = sp.show === "all";
  const shown = [...rows].sort((a, b) => ORDER[a.state] - ORDER[b.state] || a.employee.employeeNumber.localeCompare(b.employee.employeeNumber)).filter((r) => showAll || r.state !== "ACKNOWLEDGED");
  const archived = policy.status === "ARCHIVED";
  return (
    <>
      <PageHeader
        title={policy.title}
        crumbs={[{ href: "/hr/policies", label: "Policies" }]}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={policy.status} /> {policy.category?.name ?? "Everyone"} · {policy.graceDays} days to acknowledge
            {current ? ` · version ${current.version} in effect since ${fmtDate(current.effectiveDate)}` : " · not yet in effect"}
          </span>
        }
        actions={
          configure ? (
            <ActionButton action={setPolicyStatusAction.bind(null, policy.id, archived ? "ACTIVE" : "ARCHIVED")} confirm={archived ? "Restore this policy?" : "Archive this policy? Nobody will be asked to acknowledge it."} variant="outline">
              {archived ? "Restore" : "Archive"}
            </ActionButton>
          ) : undefined
        }
      />

      {!archived && current && (
        <>
          <StatGrid cols={4}>
            <Stat label="Applies to" value={totals.applicable} sub="current employees" />
            <Stat label="Acknowledged" value={`${totals.acknowledged}/${totals.applicable}`} tone={totals.acknowledged === totals.applicable && totals.applicable > 0 ? "green" : undefined} />
            <Stat label="Still to do" value={totals.pending} tone={totals.pending ? "amber" : "green"} />
            <Stat label="Overdue" value={totals.overdue} tone={totals.overdue ? "red" : "green"} />
          </StatGrid>

          <Section
            title={showAll ? "Everyone" : "Still to acknowledge"}
            description={
              <Link className="text-xs text-primary underline" href={showAll ? `/hr/policies/${policy.id}` : `/hr/policies/${policy.id}?show=all`}>
                {showAll ? "Show only who still has to" : "Show everyone, including those who have"}
              </Link>
            }
            flush
          >
            <Table>
              <THead>
                <TR>
                  <TH>Employee</TH>
                  <TH>Category</TH>
                  <TH>Status</TH>
                  <TH>Due / acknowledged</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {shown.map((r) => (
                  <TR key={r.employee.id}>
                    <TD>
                      <Link className="text-primary hover:underline" href={`/employees/${r.employee.id}?tab=documents`}>
                        {r.employee.employeeNumber}
                      </Link>{" "}
                      <span className="text-xs">{fullName(r.employee)}</span>
                    </TD>
                    <TD className="text-xs">{r.employee.category.name}</TD>
                    <TD>
                      <Badge tone={r.state === "ACKNOWLEDGED" ? "green" : r.state === "OVERDUE" ? "red" : "amber"}>{ACK_LABELS[r.state]}</Badge>
                    </TD>
                    <TD className="text-xs">
                      {r.acknowledgedAt ? (
                        <>
                          {fmtDate(r.acknowledgedAt)}
                          {r.method === "RECORDED" && <div className="text-muted-foreground">paper sign-off — {r.note}</div>}
                        </>
                      ) : (
                        `due ${fmtDate(r.due)}`
                      )}
                    </TD>
                    <TD className="text-right">
                      {manage && r.state !== "ACKNOWLEDGED" && ctx.employeeId !== r.employee.id && (
                        <ActionButton action={recordAcknowledgementAction.bind(null, policy.id, r.employee.id)} reason reasonPlaceholder="Where's the signed sheet? (file no.)" variant="outline">
                          Record paper sign-off
                        </ActionButton>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            {!shown.length && <Empty>{showAll ? "No employees apply." : "Everyone has acknowledged the current version."}</Empty>}
          </Section>
        </>
      )}

      <Section title="Versions" description="Published wording is never edited — a change is a new version." flush>
        <Table>
          <THead>
            <TR>
              <TH>Version</TH>
              <TH>Effective</TH>
              <TH>What changed</TH>
              <TH>Wording</TH>
              <TH>Published</TH>
            </TR>
          </THead>
          <TBody>
            {versions.map((v) => (
              <TR key={v.id}>
                <TD>
                  v{v.version} {current?.id === v.id && <Badge tone="green">current</Badge>} {scheduled?.id === v.id && <Badge tone="blue">scheduled</Badge>}
                </TD>
                <TD className="text-xs">{fmtDate(v.effectiveDate)}</TD>
                <TD className="max-w-xs whitespace-normal text-xs">{v.changeSummary ?? "First version"}</TD>
                <TD className="max-w-md whitespace-normal text-xs">
                  {v.body ? (
                    <details>
                      <summary className="cursor-pointer text-primary">Read</summary>
                      <p className="mt-1 whitespace-pre-line">{v.body}</p>
                    </details>
                  ) : null}
                  {v.documentReference && <div className="text-muted-foreground">Document: {v.documentReference}</div>}
                </TD>
                <TD className="text-xs">
                  {v.publishedBy}
                  <div className="text-muted-foreground">{fmtDate(v.publishedAt)}</div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Section>

      {configure && !archived && (
        <>
          <FormPanel title="Publish a new version">
            <p className="mb-3 text-xs text-muted-foreground">Everyone this policy applies to will be asked to acknowledge the new version once it takes effect.</p>
            <SmartForm
              columns={2}
              submitLabel="Publish version"
              action={publishVersionAction.bind(null, policy.id)}
              fields={[
                { name: "changeSummary", label: "What changed?", required: true, span: 2 },
                { name: "body", label: "The new text", type: "textarea", span: 2 },
                { name: "documentReference", label: "Document reference" },
                { name: "effectiveDate", label: "Effective from", type: "date", help: "Blank = today. A future date schedules it." },
              ]}
            />
          </FormPanel>
          <FormPanel title="Edit audience and settings">
            <SmartForm
              columns={2}
              submitLabel="Save"
              resetOnSuccess={false}
              action={updatePolicyAction.bind(null, policy.id)}
              fields={[
                { name: "title", label: "Policy name", required: true, defaultValue: policy.title },
                { name: "categoryId", label: "Applies to", type: "select", options: o!.categories, defaultValue: policy.categoryId ?? undefined, help: "Blank = every employee." },
                { name: "summary", label: "One-line summary", span: 2, defaultValue: policy.summary ?? undefined },
                { name: "graceDays", label: "Days to acknowledge", type: "number", min: 0, max: 365, defaultValue: policy.graceDays },
              ]}
            />
          </FormPanel>
        </>
      )}
    </>
  );
}

