import Link from "next/link";
import { ActivityPanel } from "@/components/sales/activity-panel";
import { HealthPanel } from "@/components/sales/health-panel";
import { getAccountHealth } from "@/server/services/sales/health";
import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth/session";
import { BusinessError } from "@/server/services/_base";
import { accountView } from "@/server/services/sales/views";
import { naira } from "@/lib/money";
import { PageHeader, Section } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");

export default async function SalesAccountPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("sales.view");
  const { id } = await params;
  let v;
  try {
    v = await accountView(ctx, id);
  } catch (e) {
    if (e instanceof BusinessError) notFound();
    throw e;
  }
  const a = v.account;
  const health = await getAccountHealth(ctx, id);
  return (
    <>
      <PageHeader title={a.name} crumbs={[{ href: "/sales/accounts", label: "Accounts" }]} description={`Owner ${a.ownerName}.`} />
      {a.status === "VOID" && (
        <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-900">
          This account is voided{a.voidReason ? `: ${a.voidReason}` : ""}.{" "}
          {a.mergedInto && (
            <Link className="underline" href={`/sales/accounts/${a.mergedInto.id}`}>
              Open {a.mergedInto.name}
            </Link>
          )}
        </p>
      )}
      <Section title="Details">
        <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
          <div><dt className="text-xs text-muted-foreground">Type</dt><dd><Badge>{label(a.accountType)}</Badge></dd></div>
          <div><dt className="text-xs text-muted-foreground">Industry</dt><dd>{a.industry ?? "—"}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Where</dt><dd>{[a.address, a.lga, a.state].filter(Boolean).join(", ") || "—"}</dd></div>
          <div><dt className="text-xs text-muted-foreground">RC number</dt><dd>{a.rcNumber ?? "—"}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Source</dt><dd>{a.source ? label(a.source) : "—"}{a.sourceDetail ? ` (${a.sourceDetail})` : ""}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Email domain</dt><dd>{a.emailDomain ?? "—"}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Part of</dt><dd>{a.parent ? <Link className="underline" href={`/sales/accounts/${a.parent.id}`}>{a.parent.name}</Link> : "—"}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Client record</dt><dd>{a.clientId ? "Linked to a client" : "Not yet a client (a won deal is handed over in a later phase)"}</dd></div>
        </dl>
      </Section>
      <Section title={`${v.contacts.length} contact(s)`} flush>
        <Table>
          <THead><TR><TH>Name</TH><TH>Role</TH><TH>Phone</TH><TH>Email</TH></TR></THead>
          <TBody>
            {v.contacts.map((c) => (
              <TR key={c.id}>
                <TD><Link className="underline" href={`/sales/contacts/${c.id}`}>{c.firstName} {c.lastName}</Link>{c.isPrimary ? <span className="ml-2 text-xs text-muted-foreground">primary</span> : null}</TD>
                <TD className="text-xs">{c.roleInDecision ? label(c.roleInDecision) : "—"}</TD>
                <TD className="font-mono text-xs">{c.phoneE164 ?? "—"}</TD>
                <TD className="text-xs">{c.email ?? "—"}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!v.contacts.length && <p className="px-4 py-4 text-sm text-muted-foreground">No contacts yet.</p>}
      </Section>
      <Section title={`${v.opportunities.length} deal(s)`} flush>
        <Table>
          <THead><TR><TH>Deal</TH><TH>Stage</TH><TH className="text-right">Monthly value</TH><TH className="text-right">Probability</TH></TR></THead>
          <TBody>
            {v.opportunities.map((o) => (
              <TR key={o.id}>
                <TD>{o.name}</TD>
                <TD><Badge>{o.stage.name}</Badge></TD>
                <TD className="text-right">{naira(o.monthlyContractValue)}</TD>
                <TD className="text-right text-xs">{o.probability}%</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!v.opportunities.length && <p className="px-4 py-4 text-sm text-muted-foreground">No deals yet.</p>}
      </Section>
      {v.children.length > 0 && (
        <Section title="Group companies">
          <ul className="text-sm">
            {v.children.map((c) => (
              <li key={c.id}><Link className="underline" href={`/sales/accounts/${c.id}`}>{c.name}</Link></li>
            ))}
          </ul>
        </Section>
      )}
      {health && <HealthPanel health={health} />}
      <ActivityPanel ctx={ctx} target={{ accountId: id }} />
    </>
  );
}
