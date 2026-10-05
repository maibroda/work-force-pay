import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { inventorySummary, listItems } from "@/server/services/inventory";
import { enumOptions } from "@/server/options";
import { naira } from "@/lib/money";
import { FilterBar, FilterField, FormPanel, PageHeader, Section, Stat, StatGrid, Empty } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { Input, Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TFoot, TH, THead, TR } from "@/components/ui/table";
import { createItemAction, receiveStockAction } from "@/app/actions/inventory";

const CATEGORIES = ["UNIFORM", "FOOTWEAR", "ACCESSORY", "EQUIPMENT", "OTHER"];

export default async function InventoryPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePage("inventory.view");
  const sp = await searchParams;
  const manage = can(ctx.role, "inventory.manage");
  const [rows, all, sum] = await Promise.all([
    listItems(ctx, { q: sp.q, category: sp.category, lowOnly: sp.low === "1", includeInactive: sp.inactive === "1" }),
    listItems(ctx),
    inventorySummary(ctx),
  ]);
  const label = (i: { sku: string; name: string; size: string | null; quantityOnHand: number }) =>
    `${i.sku} — ${i.name}${i.size ? ` (${i.size})` : ""} · ${i.quantityOnHand} in stock`;
  return (
    <>
      <PageHeader
        title="Stock & kit"
        description="Uniform, footwear, accessories and equipment. Every unit received, issued, returned or adjusted is a ledger entry; stock can't go below zero and the average cost updates on each delivery."
      />
      <StatGrid cols={5}>
        <Stat label="Stock lines" value={sum.itemCount} />
        <Stat label="Stock value" value={naira(sum.stockValue)} />
        <Link href="/inventory?low=1" className="block">
          <Stat label="At or below reorder level" value={sum.lowStock} tone={sum.lowStock ? "amber" : undefined} />
        </Link>
        <Link href="/inventory/outstanding" className="block">
          <Stat label="Held by staff" value={naira(sum.heldValue)} sub={`${sum.holders} employee(s)`} />
        </Link>
        <Link href="/inventory/outstanding" className="block">
          <Stat label="Held by people who've left" value={sum.leaversHolding} tone={sum.leaversHolding ? "red" : undefined} />
        </Link>
      </StatGrid>

      {manage && (
        <div className="grid gap-5 lg:grid-cols-2">
          <FormPanel title="Add a stock item">
            <SmartForm
              columns={2}
              submitLabel="Add item"
              action={createItemAction}
              fields={[
                { name: "name", label: "Name", required: true, placeholder: "Uniform shirt", span: 2 },
                { name: "size", label: "Size", placeholder: "L / 42 / one size", help: "One line per size." },
                { name: "category", label: "Category", type: "select", defaultValue: "UNIFORM", options: enumOptions(CATEGORIES) },
                { name: "unit", label: "Unit", defaultValue: "pcs" },
                { name: "reorderLevel", label: "Reorder level", type: "number", min: 0, defaultValue: 0, help: "0 = no warning." },
                { name: "openingQuantity", label: "Opening quantity", type: "number", min: 0 },
                { name: "openingUnitCost", label: "Opening unit cost (₦)", type: "number", min: 0 },
              ]}
            />
          </FormPanel>
          <FormPanel title="Receive stock">
            <SmartForm
              columns={2}
              submitLabel="Receive"
              action={receiveStockAction}
              fields={[
                { name: "itemId", label: "Item", type: "select", required: true, span: 2, options: all.map((i) => ({ value: i.id, label: label(i) })) },
                { name: "quantity", label: "Quantity", type: "number", required: true, min: 1 },
                { name: "unitCost", label: "Unit cost (₦)", type: "number", required: true, min: 0 },
                { name: "reference", label: "Delivery note / invoice", span: 2 },
              ]}
            />
          </FormPanel>
        </div>
      )}

      <FilterBar>
        <FilterField label="Search">
          <Input name="q" defaultValue={sp.q ?? ""} placeholder="Name, SKU, size" className="w-52" />
        </FilterField>
        <FilterField label="Category">
          <Select name="category" defaultValue={sp.category ?? ""}>
            <option value="">All</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c.charAt(0) + c.slice(1).toLowerCase()}
              </option>
            ))}
          </Select>
        </FilterField>
        <FilterField label="Show">
          <Select name="low" defaultValue={sp.low ?? ""}>
            <option value="">Everything</option>
            <option value="1">Low stock only</option>
          </Select>
        </FilterField>
        <FilterField label="Switched-off items">
          <Select name="inactive" defaultValue={sp.inactive ?? ""}>
            <option value="">Hide</option>
            <option value="1">Include</option>
          </Select>
        </FilterField>
      </FilterBar>

      <Section title={`${rows.length} item(s)`} flush>
        <Table>
          <THead>
            <TR>
              <TH>SKU</TH>
              <TH>Item</TH>
              <TH>Category</TH>
              <TH className="text-right">On hand</TH>
              <TH className="text-right">Reorder at</TH>
              <TH className="text-right">Avg cost</TH>
              <TH className="text-right">Value</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((i) => (
              <TR key={i.id} className={i.active ? "" : "opacity-50"}>
                <TD className="font-mono text-xs">
                  <Link className="text-primary underline" href={`/inventory/${i.id}`}>
                    {i.sku}
                  </Link>
                </TD>
                <TD>
                  {i.name}
                  {i.size ? <span className="text-muted-foreground"> — {i.size}</span> : null}
                  {!i.active && <Badge className="ml-2">off</Badge>}
                </TD>
                <TD className="text-xs">{i.category.toLowerCase()}</TD>
                <TD className="text-right font-medium">
                  {i.quantityOnHand} {i.low && <Badge tone="amber">low</Badge>}
                </TD>
                <TD className="text-right text-xs">{i.reorderLevel || "—"}</TD>
                <TD className="text-right">{naira(i.averageCost)}</TD>
                <TD className="text-right">{naira(i.value)}</TD>
              </TR>
            ))}
          </TBody>
          <TFoot>
            <TR className="font-semibold">
              <TD colSpan={6}>Total</TD>
              <TD className="text-right">{naira(rows.reduce((s, r) => s + r.value, 0))}</TD>
            </TR>
          </TFoot>
        </Table>
        {!rows.length && <Empty>No stock items match.</Empty>}
      </Section>
    </>
  );
}
