import { requirePage } from "@/lib/auth/session";
import { listVendors } from "@/server/services/payables";
import { options } from "@/server/options";
import { previewNextNumber } from "@/server/services/numbering";
import { PageHeader, Section } from "@/components/page";
import { NewOrderForm } from "./new-order-form";

export default async function NewPurchaseOrderPage() {
  const ctx = await requirePage("payment.manage");
  const [vendors, o, nextNum] = await Promise.all([
    listVendors(ctx),
    options(ctx),
    previewNextNumber(ctx, "PURCHASE_ORDER"),
  ]);
  return (
    <>
      <PageHeader
        title="Request a purchase order"
        crumbs={[{ href: "/finance/purchase-orders", label: "Purchase orders" }]}
        description={`Order number is generated automatically on save — next number: ${nextNum}. Submit it for approval once you're happy with the lines — they're fixed after that.`}
      />
      <Section title="Order details">
        <NewOrderForm
          vendors={vendors.filter((v) => v.active).map((v) => ({ value: v.id, label: v.name }))}
          costCenters={o.costCenters}
        />
      </Section>
    </>
  );
}
