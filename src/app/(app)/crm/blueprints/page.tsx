import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { fmtDate } from "@/lib/dates";
import { MODULES, PLANS, type PlanKey } from "@/lib/entitlements/catalogue";
import type { Quote } from "@/lib/entitlements/pricing";
import { listBlueprints } from "@/server/services/blueprints";
import { isSeller } from "@/server/services/price-book";
import { Empty, PageHeader, Section } from "@/components/page";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export default async function BlueprintsPage() {
  const ctx = await requirePage("blueprint.manage");
  if (!(await isSeller(ctx))) return <PageHeader title="Blueprints and quotes" description="Blueprints and quotes are made in a payroll bureau's own organization, or by platform staff." />;
  const rows = await listBlueprints(ctx);
  return (
    <>
      <PageHeader
        title="Blueprints and quotes"
        description="What was proposed to a prospect: the modules, the plan and what it costs per month, saved with the quote as it was given. The app sends nothing and makes no subscription."
        actions={
          <Link className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground" href="/crm/blueprints/new">
            New blueprint
          </Link>
        }
      />
      <Section title="Blueprints" flush>
        {rows.length === 0 ? (
          <Empty>No blueprint yet.</Empty>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Prospect</TH>
                <TH>Plan</TH>
                <TH>Modules</TH>
                <TH>Monthly</TH>
                <TH>Status</TH>
                <TH>Made</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((b) => {
                const q = b.quote as Quote | null;
                return (
                  <TR key={b.id}>
                    <TD>
                      <Link className="font-medium underline" href={`/crm/blueprints/${b.id}`}>
                        {b.prospectName}
                      </Link>
                    </TD>
                    <TD>{PLANS[b.planKey as PlanKey]?.name ?? b.planKey}</TD>
                    <TD>{(b.modules as string[]).filter((m) => m !== "core").map((m) => MODULES[m as keyof typeof MODULES]?.name ?? m).join(", ") || "Core only"}</TD>
                    <TD>{q?.ok ? `${q.currency} ${q.monthly}` : "No total (see the quote)"}</TD>
                    <TD>
                      <StatusBadge status={b.status === "SENT" ? "ISSUED" : b.status === "ACCEPTED" ? "APPROVED" : b.status === "DROPPED" ? "CANCELLED" : "DRAFT"} /> {b.status}
                    </TD>
                    <TD>
                      {fmtDate(b.createdAt)} by {b.createdBy}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Section>
    </>
  );
}
