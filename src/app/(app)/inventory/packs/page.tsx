import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { listItems, listPacks } from "@/server/services/inventory";
import { options } from "@/server/options";
import { naira } from "@/lib/money";
import { FormPanel, PageHeader, Section, Empty } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { SmartForm } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { createPackAction, removePackLineAction, setPackActiveAction, setPackLineAction } from "@/app/actions/inventory";

export default async function PacksPage() {
  const ctx = await requirePage("inventory.view");
  const manage = can(ctx.role, "inventory.manage");
  const [packs, items, o] = await Promise.all([listPacks(ctx), listItems(ctx), options(ctx)]);
  return (
    <>
      <PageHeader
        title="Kit packs"
        description="A standard issue — say, a guard's starter kit — so onboarding is one click. Issuing a pack is all-or-nothing: if any item is short, nothing is issued."
      />
      {manage && (
        <FormPanel title="Create a kit pack">
          <SmartForm
            columns={3}
            submitLabel="Create pack"
            action={createPackAction}
            fields={[
              { name: "name", label: "Name", required: true, placeholder: "Guard starter kit" },
              { name: "categoryId", label: "Suggested for", type: "select", options: o.categories, help: "Informational — any pack can be issued to anyone." },
              { name: "description", label: "Description" },
            ]}
          />
        </FormPanel>
      )}
      {packs.map((p) => (
        <Section
          key={p.id}
          title={p.name}
          description={
            <span className="flex flex-wrap items-center gap-2">
              {p.category ? `For ${p.category.name} · ` : ""}
              {p.lines.length} item type(s) · {naira(p.unitValue)} per set · {p.setsAvailable} complete set(s) in stock
              {!p.active && <Badge>switched off</Badge>}
              {p.description && <span>· {p.description}</span>}
            </span>
          }
          actions={
            manage && (
              <ActionButton action={setPackActiveAction.bind(null, p.id, !p.active)} variant="outline">
                {p.active ? "Switch off" : "Switch on"}
              </ActionButton>
            )
          }
          flush
        >
          <Table>
            <THead>
              <TR>
                <TH>Item</TH>
                <TH className="text-right">Per set</TH>
                <TH className="text-right">In stock</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {p.lines.map((l) => (
                <TR key={l.id}>
                  <TD>
                    <Link className="text-primary underline" href={`/inventory/${l.itemId}`}>
                      {l.item.sku}
                    </Link>{" "}
                    {l.item.name}
                    {l.item.size ? ` — ${l.item.size}` : ""}
                  </TD>
                  <TD className="text-right">{l.quantity}</TD>
                  <TD className={`text-right ${l.item.quantityOnHand < l.quantity ? "font-medium text-red-700" : ""}`}>{l.item.quantityOnHand}</TD>
                  <TD>
                    {manage && (
                      <ActionButton action={removePackLineAction.bind(null, l.id)} confirm="Remove from the pack?" variant="outline">
                        Remove
                      </ActionButton>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          {!p.lines.length && <Empty>No items yet — add some below.</Empty>}
          {manage && (
            <div className="border-t p-4">
              <SmartForm
                columns={3}
                submitLabel="Add / change item"
                action={setPackLineAction.bind(null, p.id)}
                fields={[
                  { name: "itemId", label: "Item", type: "select", required: true, options: items.map((i) => ({ value: i.id, label: `${i.sku} — ${i.name}${i.size ? ` (${i.size})` : ""}` })) },
                  { name: "quantity", label: "Quantity per set", type: "number", required: true, min: 1 },
                ]}
              />
            </div>
          )}
        </Section>
      ))}
      {!packs.length && (
        <Section title="No kit packs yet">
          <Empty>Create one above, then add the items it contains.</Empty>
        </Section>
      )}
    </>
  );
}
