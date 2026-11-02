import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { BusinessError } from "@/server/services/_base";
import { listOpportunities } from "@/server/services/sales/pipelines";
import { listAccounts } from "@/server/services/sales/records";
import { naira } from "@/lib/money";
import { PageHeader, Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { createOpportunityAction } from "@/app/actions/sales";

const SERVICES = ["GUARDING", "CLEANING", "FACILITY", "STAFFING", "OTHER"];
const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");

export default async function SalesOpportunitiesPage() {
  const ctx = await requirePage("sales.view");
  let deals: Awaited<ReturnType<typeof listOpportunities>> = [];
  let accounts: Awaited<ReturnType<typeof listAccounts>> = [];
  let why = "";
  try {
    [deals, accounts] = await Promise.all([listOpportunities(ctx), listAccounts(ctx)]);
  } catch (e) {
    if (!(e instanceof BusinessError)) throw e;
    why = e.message;
  }
  return (
    <>
      <PageHeader title="Deals" description="Specific bids for a client's business. A deal starts in the first stage of the New business pipeline with that stage's probability. The board and stage rules come in the next phase." />
      {why && (
        <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {why}{" "}
          {can(ctx.role, "sales.configure") && (
            <Link className="underline" href="/sales/settings">
              Open Sales settings
            </Link>
          )}
        </p>
      )}
      {!why && (
        <Section title={`${deals.length} deal(s)`} flush>
          <Table>
            <THead>
              <TR>
                <TH>Deal</TH>
                <TH>Account</TH>
                <TH>Service</TH>
                <TH>Stage</TH>
                <TH className="text-right">Monthly value</TH>
                <TH className="text-right">Probability</TH>
                <TH>Owner</TH>
              </TR>
            </THead>
            <TBody>
              {deals.map((d) => (
                <TR key={d.id}>
                  <TD>{d.name}</TD>
                  <TD className="text-xs">{d.account.name}</TD>
                  <TD className="text-xs">{label(d.serviceType)}</TD>
                  <TD>
                    <Badge>{d.stage.name}</Badge>
                  </TD>
                  <TD className="text-right">{naira(d.monthlyContractValue)}</TD>
                  <TD className="text-right text-xs">{d.probability}%</TD>
                  <TD className="text-xs">{d.ownerName}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
          {!deals.length && <p className="px-4 py-4 text-sm text-muted-foreground">No deals yet. Converting a lead creates one, or add one on an account below.</p>}
        </Section>
      )}
      {!why && can(ctx.role, "sales.manage") && (
        <Section title="Add a deal" description="The monthly value is in naira with at most two decimals; more than that is refused, never rounded.">
          <SmartForm
            columns={3}
            submitLabel="Add deal"
            resetOnSuccess
            action={createOpportunityAction}
            fields={[
              { name: "name", label: "Deal name", required: true },
              { name: "accountId", label: "Account", type: "select", required: true, options: [{ value: "", label: "— choose —" }, ...accounts.map((a) => ({ value: a.id, label: a.name }))] },
              { name: "serviceType", label: "Service", type: "select", defaultValue: "GUARDING", options: SERVICES.map((s) => ({ value: s, label: label(s) })) },
              { name: "monthlyContractValue", label: "Monthly value (naira)" },
              { name: "expectedCloseDate", label: "Expected close date", type: "date" },
            ]}
          />
        </Section>
      )}
    </>
  );
}
