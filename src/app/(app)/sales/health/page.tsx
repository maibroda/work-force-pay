import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { listHealth } from "@/server/services/sales/health";
import { PageHeader, Section } from "@/components/page";
import { bandBadge } from "@/components/sales/health-panel";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export default async function HealthListPage() {
  const ctx = await requirePage("sales.view");
  const rows = await listHealth(ctx);
  const risk = rows.filter((r) => r.band === "AT_RISK").length;
  return (
    <>
      <PageHeader title="Account health" description="How each client account is doing, weakest first: missed deadlines, open severe cases, guard absence, overdue invoices, a contract ending without a renewal, and time since the last contact. At-risk accounts give their owner a task." />
      <Section title={`${rows.length} client account(s), ${risk} at risk`} flush>
        <Table>
          <THead><TR><TH>Account</TH><TH>Owner</TH><TH className="text-right">Score</TH><TH>Band</TH></TR></THead>
          <TBody>
            {rows.map((r) => {
              const b = bandBadge(r.band);
              return (
                <TR key={r.id}>
                  <TD><Link className="underline" href={`/sales/accounts/${r.account.id}`}>{r.account.name}</Link></TD>
                  <TD className="text-xs">{r.account.ownerName}</TD>
                  <TD className="text-right">{r.score}</TD>
                  <TD><Badge tone={b.tone}>{b.label}</Badge></TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
        {!rows.length && <p className="px-4 py-4 text-sm text-muted-foreground">No scores yet. They are worked out every night for accounts that are linked to a client.</p>}
      </Section>
    </>
  );
}
