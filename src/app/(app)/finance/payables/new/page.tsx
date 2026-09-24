import { requirePage } from "@/lib/auth/session";
import { listVendors } from "@/server/services/payables";
import { options } from "@/server/options";
import { previewNextNumber } from "@/server/services/numbering";
import { PageHeader, Section } from "@/components/page";
import { NewInvoiceForm } from "./new-invoice-form";

export default async function NewPurchaseInvoicePage() {
  const ctx = await requirePage("payment.manage");
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
          vendors={vendors.filter((v) => v.active).map((v) => ({ value: v.id, label: v.name }))}
          costCenters={o.costCenters}
        />
      </Section>
    </>
  );
}
