import { requirePage } from "@/lib/auth/session";
import { listVendors } from "@/server/services/payables";
import { getPurchaseOrder } from "@/server/services/purchase-orders";
import { num } from "@/lib/money";
import { options } from "@/server/options";
import { previewNextNumber } from "@/server/services/numbering";
import { PageHeader, Section } from "@/components/page";
import { NewInvoiceForm } from "./new-invoice-form";

export default async function NewPurchaseInvoicePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePage("payment.manage");
  const sp = await searchParams;
  const po = sp.po ? await getPurchaseOrder(ctx, sp.po) : null;
  const order = po && po.status === "APPROVED"
    ? {
        id: po.id,
        orderNumber: po.orderNumber,
        vendorId: po.vendorId,
        costCenterId: po.costCenterId ?? "",
        description: po.description,
        vatPct: num(po.vatPct),
        lines: po.lines.map((l) => ({ id: l.id, description: l.description, quantity: num(l.quantity), rate: num(l.rate) })),
      }
    : undefined;
  const [vendors, o, nextNum] = await Promise.all([
    listVendors(ctx),
    options(ctx),
    previewNextNumber(ctx, "PURCHASE_INVOICE"),
  ]);
  return (
    <>
      <PageHeader
        title="Record a vendor bill"
        crumbs={[{ href: "/finance/payables", label: "Billing & payables" }]}
        description={`Invoice number is generated automatically on save — next number: ${nextNum}.`}
      />
      <Section title="Bill details">
        <NewInvoiceForm
          vendors={vendors.filter((v) => v.active || v.id === order?.vendorId).map((v) => ({ value: v.id, label: v.name }))}
          costCenters={o.costCenters}
          order={order}
        />
      </Section>
    </>
  );
}
