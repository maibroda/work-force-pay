import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { listChanges } from "@/server/services/change-requests";
import { FIELD_LABELS, KIND_FIELDS, KIND_LABELS } from "@/lib/change-control";
import { fmtDate } from "@/lib/dates";
import { fullName } from "@/lib/utils";
import { PageHeader, Section, Stat, StatGrid, Empty } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { approveChangeAction, rejectChangeAction } from "@/app/actions/change-requests";

const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));
const FILTERS = [
  ["", "Waiting"],
  ["APPROVED", "Approved"],
  ["REJECTED", "Rejected"],
  ["CANCELLED", "Cancelled"],
  ["ALL", "All"],
] as const;

export default async function ChangeRequestsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePage("employee.sensitive");
  const sp = await searchParams;
  const filter = sp.status ?? "";
  const decide = can(ctx.role, "employee.approve");
  const all = await listChanges(ctx);
  const rows = all.filter((r) => (filter === "ALL" ? true : filter ? r.status === filter : r.status === "PENDING"));
  const pending = all.filter((r) => r.status === "PENDING");
  return (
    <>
      <PageHeader
        title="Detail change requests"
        description="Requests to change an employee's bank, tax or pension details. Nothing changes until someone other than the requester approves it. Check the account name and who else holds the number before approving."
      />
      <StatGrid cols={3}>
        <Stat label="Waiting for approval" value={pending.length} tone={pending.length ? "amber" : "green"} />
        <Stat label="Account name doesn't match" value={pending.filter((r) => r.nameMatches === false).length} tone={pending.some((r) => r.nameMatches === false) ? "red" : "green"} />
        <Stat label="Approved in the last 30 days" value={all.filter((r) => r.status === "APPROVED" && r.decidedAt && r.decidedAt.getTime() > Date.now() - 30 * 86_400_000).length} />
      </StatGrid>
      <Section
        title="Requests"
        description={
          <span className="flex flex-wrap gap-2">
            {FILTERS.map(([k, label]) => (
              <Link key={k} href={k ? `/employees/change-requests?status=${k}` : "/employees/change-requests"} className={`rounded-full px-2.5 py-0.5 text-xs ring-1 ${filter === k ? "bg-primary text-primary-foreground ring-primary" : "ring-border hover:bg-muted"}`}>
                {label}
              </Link>
            ))}
          </span>
        }
        flush
      >
        <Table>
          <THead>
            <TR>
              <TH>Employee</TH>
              <TH>Change</TH>
              <TH>Requested</TH>
              <TH>Reason</TH>
              <TH>Status</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => {
              const prev = r.previous as Record<string, unknown>;
              const next = r.proposed as Record<string, unknown>;
              return (
                <TR key={r.id}>
                  <TD>
                    <Link className="text-primary hover:underline" href={`/employees/${r.employee.id}?tab=details`}>
                      {r.employee.employeeNumber}
                    </Link>{" "}
                    <span className="text-xs">{fullName(r.employee)}</span>
                  </TD>
                  <TD>
                    <b className="text-xs">{KIND_LABELS[r.kind]}</b>
                    <ul className="text-xs">
                      {KIND_FIELDS[r.kind].map((f) => (
                        <li key={f} className={show(prev[f]) === show(next[f]) ? "text-muted-foreground" : ""}>
                          <span className="text-muted-foreground">{FIELD_LABELS[f]}:</span> {show(prev[f])}
                          {show(prev[f]) !== show(next[f]) && (
                            <>
                              {" "}→ <b>{show(next[f])}</b>
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                    {r.status === "PENDING" && (
                      <div className="mt-1 space-x-1">
                        {r.nameMatches === false && <Badge tone="amber">Account name doesn&apos;t match</Badge>}
                        {r.nameMatches === true && <Badge tone="green">Name matches</Badge>}
                        {r.clash && <Badge tone="red">Already on {r.clash}</Badge>}
                      </div>
                    )}
                  </TD>
                  <TD className="text-xs">
                    {r.requestedBy}
                    <div className="text-muted-foreground">{fmtDate(r.createdAt)}</div>
                  </TD>
                  <TD className="max-w-xs whitespace-normal text-xs">{r.reason}</TD>
                  <TD className="max-w-[12rem] whitespace-normal text-xs">
                    <StatusBadge status={r.status} />
                    {r.decidedBy && (
                      <div className="mt-1 text-muted-foreground">
                        {r.decidedBy}, {fmtDate(r.decidedAt)}
                        {r.decisionNote ? ` — ${r.decisionNote}` : ""}
                      </div>
                    )}
                  </TD>
                  <TD className="space-x-1 whitespace-nowrap text-right">
                    {decide && r.status === "PENDING" && r.requestedByUserId !== ctx.userId && ctx.employeeId !== r.employeeId && (
                      <>
                        <ActionButton action={approveChangeAction.bind(null, r.id)} confirm="Approve this change? The employee's details will be updated now." variant="success">
                          Approve
                        </ActionButton>
                        <ActionButton action={rejectChangeAction.bind(null, r.id)} reason variant="outline">
                          Reject
                        </ActionButton>
                      </>
                    )}
                    {r.status === "PENDING" && r.requestedByUserId === ctx.userId && <span className="text-xs text-muted-foreground">You requested this</span>}
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
        {!rows.length && <Empty>{filter ? "No requests with that status." : "Nothing is waiting for approval."}</Empty>}
      </Section>
    </>
  );
}
