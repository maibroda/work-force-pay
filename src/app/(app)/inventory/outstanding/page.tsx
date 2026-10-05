import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { outstandingKit } from "@/server/services/inventory";
import { naira } from "@/lib/money";
import { fullName } from "@/lib/utils";
import { PageHeader, Section, Empty } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TFoot, TH, THead, TR } from "@/components/ui/table";
import { returnHeldAction } from "@/app/actions/inventory";

const GONE = ["EXITED", "TERMINATED", "RESIGNED"];

export default async function OutstandingKitPage() {
  const ctx = await requirePage("inventory.view");
  const manage = can(ctx.role, "inventory.manage");
  const rows = await outstandingKit(ctx);
  return (
    <>
      <PageHeader
        title="Kit held by staff"
        description="Everything issued and not yet returned. People who have already left come first — chase these, or recover the value through their end-of-service settlement."
      />
      <Section title={`${rows.length} line(s) · ${naira(rows.reduce((s, r) => s + r.value, 0))}`} flush>
        <Table>
          <THead>
            <TR>
              <TH>Employee</TH>
              <TH>Status</TH>
              <TH>Item</TH>
              <TH className="text-right">Issued</TH>
              <TH className="text-right">Returned</TH>
              <TH className="text-right">Held</TH>
              <TH className="text-right">Value</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => {
              const left = GONE.includes(r.employee.status);
              return (
                <TR key={`${r.employee.id}${r.item.id}`} className={left ? "bg-red-50/60" : ""}>
                  <TD>
                    <Link className="text-primary underline" href={`/employees/${r.employee.id}?tab=kit`}>
                      {r.employee.employeeNumber} — {fullName(r.employee)}
                    </Link>
                  </TD>
                  <TD>
                    <StatusBadge status={r.employee.status} />
                  </TD>
                  <TD>
                    {r.item.name}
                    {r.item.size ? ` — ${r.item.size}` : ""}
                  </TD>
                  <TD className="text-right">{r.issued}</TD>
                  <TD className="text-right">{r.returned}</TD>
                  <TD className="text-right font-medium">{r.outstanding}</TD>
                  <TD className="text-right">{naira(r.value)}</TD>
                  <TD>
                    {manage && (
                      <div className="flex flex-wrap gap-1">
                        <ActionButton action={returnHeldAction.bind(null, r.employee.id, r.item.id, r.outstanding, "GOOD", undefined)} variant="success">
                          Returned
                        </ActionButton>
                        <ActionButton action={returnHeldAction.bind(null, r.employee.id, r.item.id, r.outstanding, "DAMAGED")} reason reasonPlaceholder="What's wrong with it?" variant="outline">
                          Damaged
                        </ActionButton>
                        <ActionButton action={returnHeldAction.bind(null, r.employee.id, r.item.id, r.outstanding, "LOST")} reason reasonPlaceholder="What happened to it?" variant="outline">
                          Lost
                        </ActionButton>
                      </div>
                    )}
                  </TD>
                </TR>
              );
            })}
          </TBody>
          <TFoot>
            <TR className="font-semibold">
              <TD colSpan={6}>Total held</TD>
              <TD className="text-right">{naira(rows.reduce((s, r) => s + r.value, 0))}</TD>
              <TD />
            </TR>
          </TFoot>
        </Table>
        {!rows.length && <Empty>Nothing is out — all issued kit has been returned.</Empty>}
      </Section>
    </>
  );
}
