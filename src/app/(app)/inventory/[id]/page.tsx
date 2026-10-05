import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { getItem } from "@/server/services/inventory";
import { fmtDate } from "@/lib/dates";
import { naira } from "@/lib/money";
import { fullName } from "@/lib/utils";
import { FormPanel, KV, PageHeader, Section, Empty } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { SmartForm } from "@/components/smart-form";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import {
  adjustStockAction,
  receiveStockAction,
  toggleItemAction,
  updateItemAction,
  writeOffStockAction,
} from "@/app/actions/inventory";

export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("inventory.view");
  const { id } = await params;
  const i = await getItem(ctx, id);
  if (!i) notFound();
  const manage = can(ctx.role, "inventory.manage");
  return (
    <>
      <PageHeader
        title={`${i.sku} — ${i.name}${i.size ? ` (${i.size})` : ""}`}
        crumbs={[{ href: "/inventory", label: "Stock & kit" }]}
        description={
          <span className="flex items-center gap-2">
            {i.quantityOnHand} on hand · {naira(i.value)}
            {i.low && <Badge tone="amber">at or below reorder level</Badge>}
            {!i.active && <Badge>switched off</Badge>}
          </span>
        }
        actions={
          manage && (
            <ActionButton action={toggleItemAction.bind(null, i.id, !i.active)} variant="outline">
              {i.active ? "Switch off" : "Switch on"}
            </ActionButton>
          )
        }
      />
      <Section title="Item">
        <KV
          cols={4}
          items={[
            ["Category", i.category.toLowerCase()],
            ["Unit", i.unit],
            ["Reorder level", i.reorderLevel || "None set"],
            ["Average cost", naira(i.averageCost)],
            ["On hand", i.quantityOnHand],
            ["Stock value", naira(i.value)],
            ["Notes", i.notes],
          ]}
        />
      </Section>

      <Section title="Ledger" description="Newest first. The shelf count is the running total of this ledger." flush>
        <Table>
          <THead>
            <TR>
              <TH>Date</TH>
              <TH>Movement</TH>
              <TH className="text-right">Qty</TH>
              <TH className="text-right">Unit cost</TH>
              <TH>Employee</TH>
              <TH>Reference / reason</TH>
              <TH className="text-right">Balance</TH>
              <TH>By</TH>
            </TR>
          </THead>
          <TBody>
            {i.movements.map((m) => (
              <TR key={m.id}>
                <TD className="text-xs">{fmtDate(m.movementDate)}</TD>
                <TD>
                  <StatusBadge status={m.type} />
                  {m.condition && m.condition !== "GOOD" && <span className="ml-1 text-xs text-red-700">{m.condition.toLowerCase()}</span>}
                </TD>
                <TD className={`text-right ${m.stockDelta < 0 ? "text-red-700" : m.stockDelta > 0 ? "text-emerald-700" : ""}`}>
                  {m.stockDelta > 0 ? "+" : ""}
                  {m.stockDelta === 0 ? `(${m.quantity})` : m.stockDelta}
                </TD>
                <TD className="text-right text-xs">{naira(m.unitCost)}</TD>
                <TD className="text-xs">
                  {m.employee ? (
                    <Link className="text-primary underline" href={`/employees/${m.employee.id}?tab=kit`}>
                      {m.employee.employeeNumber} — {fullName(m.employee)}
                    </Link>
                  ) : (
                    "—"
                  )}
                </TD>
                <TD className="max-w-xs whitespace-normal text-xs">{[m.reference, m.reason].filter(Boolean).join(" · ") || "—"}</TD>
                <TD className="text-right font-medium">{m.balanceAfter}</TD>
                <TD className="text-xs">{m.createdBy}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!i.movements.length && <Empty>No movements yet.</Empty>}
      </Section>

      {manage && (
        <div className="grid gap-5 lg:grid-cols-2">
          <FormPanel title="Receive stock">
            <SmartForm
              columns={2}
              submitLabel="Receive"
              action={receiveStockAction}
              fields={[
                { name: "itemId", label: "", type: "hidden", defaultValue: i.id },
                { name: "quantity", label: "Quantity", type: "number", required: true, min: 1 },
                { name: "unitCost", label: "Unit cost (₦)", type: "number", required: true, min: 0, defaultValue: Number(i.averageCost) },
                { name: "reference", label: "Delivery note / invoice", span: 2 },
              ]}
            />
          </FormPanel>
          <FormPanel title="Stocktake — set the shelf count">
            <SmartForm
              columns={2}
              submitLabel="Record count"
              action={adjustStockAction}
              fields={[
                { name: "itemId", label: "", type: "hidden", defaultValue: i.id },
                { name: "countedQuantity", label: "Counted on the shelf", type: "number", required: true, min: 0, help: `System says ${i.quantityOnHand}.` },
                { name: "reason", label: "Reason", required: true, placeholder: "Stocktake 30 Sep" },
              ]}
            />
          </FormPanel>
          <FormPanel title="Write off damaged or expired stock">
            <SmartForm
              columns={2}
              submitLabel="Write off"
              action={writeOffStockAction}
              fields={[
                { name: "itemId", label: "", type: "hidden", defaultValue: i.id },
                { name: "quantity", label: "Quantity", type: "number", required: true, min: 1 },
                { name: "reason", label: "Reason", required: true },
              ]}
            />
          </FormPanel>
          <FormPanel title="Edit item">
            <SmartForm
              columns={2}
              submitLabel="Save"
              resetOnSuccess={false}
              action={updateItemAction.bind(null, i.id)}
              fields={[
                { name: "name", label: "Name", defaultValue: i.name },
                { name: "reorderLevel", label: "Reorder level", type: "number", min: 0, defaultValue: i.reorderLevel },
                { name: "notes", label: "Notes", span: 2, defaultValue: i.notes ?? "" },
              ]}
            />
          </FormPanel>
        </div>
      )}
    </>
  );
}
