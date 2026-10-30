import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { listCases } from "@/server/services/sales/cases";
import { listAccounts } from "@/server/services/sales/records";
import { createCaseAction } from "@/app/actions/sales-cases";
import { PageHeader, Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");
const TONE = { OK: undefined, NONE: undefined, WARNING: "amber", BREACHED: "red", MET: "green", LATE: "red" } as const;
const when = (d: Date) => d.toLocaleString("en-NG", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default async function CasesPage() {
  const ctx = await requirePage("sales.view");
  const manage = can(ctx.role, "sales.case.manage");
  const [cases, accounts] = await Promise.all([listCases(ctx), manage ? listAccounts(ctx) : Promise.resolve([])]);
  const open = cases.filter((c) => c.status === "OPEN");
  return (
    <>
      <PageHeader title="Cases" description="Problems and requests from client accounts, each with the deadlines its SLA gives it. Warnings come at 75% of a window; a missed window is flagged and escalated to the sales managers. A reopened case restarts its resolution clock and is counted separately." />
      <Section title={`${open.length} open, ${cases.length - open.length} resolved`} flush>
        <Table>
          <THead>
            <TR><TH>Case</TH><TH>Account</TH><TH>Priority</TH><TH>First response</TH><TH>Resolution</TH><TH className="text-right">Reopened</TH><TH>Opened</TH></TR>
          </THead>
          <TBody>
            {cases.map((c) => (
              <TR key={c.id}>
                <TD className="whitespace-normal text-xs"><Link className="underline" href={`/sales/cases/${c.id}`}>{c.number}</Link>: {c.subject}{c.status === "RESOLVED" && <span className="ml-1 text-muted-foreground">(resolved)</span>}</TD>
                <TD className="whitespace-normal text-xs">{c.account.name}</TD>
                <TD className="text-xs">{label(c.priority)}</TD>
                <TD><Badge tone={TONE[c.firstResponse]}>{label(c.firstResponse)}</Badge></TD>
                <TD><Badge tone={TONE[c.resolution]}>{label(c.resolution)}</Badge></TD>
                <TD className="text-right text-xs">{c.reopenedCount || ""}</TD>
                <TD className="text-xs">{when(c.openedAt)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!cases.length && <p className="px-4 py-4 text-sm text-muted-foreground">No cases yet.</p>}
      </Section>
      {manage && accounts.length > 0 && (
        <Section title="Open a case">
          <SmartForm
            columns={2}
            submitLabel="Open the case"
            action={createCaseAction}
            fields={[
              { name: "accountId", label: "Account", type: "select", required: true, options: [{ value: "", label: "— choose —" }, ...accounts.map((a) => ({ value: a.id, label: a.name }))] },
              { name: "category", label: "Category", type: "select", defaultValue: "SERVICE_QUALITY", options: ["SERVICE_QUALITY", "STAFFING", "BILLING", "COMPLAINT", "REQUEST", "OTHER"].map((v) => ({ value: v, label: label(v) })) },
              { name: "priority", label: "Priority", type: "select", defaultValue: "NORMAL", options: ["LOW", "NORMAL", "HIGH", "CRITICAL"].map((v) => ({ value: v, label: label(v) })) },
              { name: "subject", label: "What it is about", required: true },
              { name: "description", label: "Details", type: "textarea", span: 2 },
            ]}
          />
        </Section>
      )}
    </>
  );
}
