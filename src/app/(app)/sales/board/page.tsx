import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { BusinessError } from "@/server/services/_base";
import { board } from "@/server/services/sales/deals";
import { PageHeader, Section } from "@/components/page";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { BoardView } from "./board-view";

const money = (s: string) => `₦${Number(s).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default async function SalesBoardPage() {
  const ctx = await requirePage("sales.view");
  let b: Awaited<ReturnType<typeof board>> | null = null;
  let why = "";
  try {
    b = await board(ctx);
  } catch (e) {
    if (!(e instanceof BusinessError)) throw e;
    why = e.message;
  }
  return (
    <>
      <PageHeader
        title="Deals board"
        description="Each column is a stage. Drag a deal to another stage (or use the Move menu on the card): you will be asked for the next step, and a stage may need things filled in first. A card turns red when the deal has had no activity for 14 days. A sales person sees their own deals; a manager sees everyone's."
      />
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
      {b && (
        <>
          <BoardView
            canMove={can(ctx.role, "sales.manage")}
            columns={b.columns.map((c) => ({ ...c, stage: { ...c.stage, stageType: c.stage.stageType as "OPEN" | "WON" | "LOST" }, deals: c.deals.map((d) => ({ ...d, expectedCloseDate: d.expectedCloseDate ? d.expectedCloseDate.toISOString() : null })) }))}
          />
          <Section title="Forecast by expected close month" description="Open deals only. Weighted value is each deal's monthly value times its probability, rounded to the kobo; the total is the exact sum of those.">
            {b.forecast.length ? (
              <Table>
                <THead>
                  <TR>
                    <TH>Month</TH>
                    <TH className="text-right">Deals</TH>
                    <TH className="text-right">Monthly value</TH>
                    <TH className="text-right">Weighted</TH>
                  </TR>
                </THead>
                <TBody>
                  {b.forecast.map((f) => (
                    <TR key={f.month}>
                      <TD>{f.month}</TD>
                      <TD className="text-right">{f.count}</TD>
                      <TD className="text-right">{money(f.value)}</TD>
                      <TD className="text-right">{money(f.weighted)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground">No open deals yet.</p>
            )}
          </Section>
        </>
      )}
    </>
  );
}
