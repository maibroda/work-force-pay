import { requirePage } from "@/lib/auth/session";
import { openInvoicesFor } from "@/server/services/receipts";
import { options } from "@/server/options";
import { iso } from "@/lib/dates";
import { FormPanel, PageHeader, Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Label, Select } from "@/components/ui/input";
import { ReceiptEditor } from "../receipt-editor";

export default async function NewReceiptPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePage("payment.manage");
  const sp = await searchParams;
  const o = await options(ctx);
  const client = o.clients.find((c) => c.value === sp.clientId);
  const invoices = client ? await openInvoicesFor(ctx, client.value) : [];
  return (
    <>
      <PageHeader
        title="Record a client receipt"
        crumbs={[{ href: "/finance/receipts", label: "Client receipts" }]}
        description="Choose the client, then say how much arrived and which of their invoices it settles. Whatever you leave unapplied is held as an advance."
      />
      <FormPanel title="Client">
        <form className="flex flex-wrap items-end gap-3" method="get">
          <div className="space-y-1">
            <Label htmlFor="clientId">Client</Label>
            <Select id="clientId" name="clientId" defaultValue={sp.clientId ?? ""}>
              <option value="">— Choose a client —</option>
              {o.clients.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" variant="outline">
            Show their open invoices
          </Button>
        </form>
      </FormPanel>
      {client && (
        <Section title={`Receipt from ${client.label}`}>
          <ReceiptEditor
            mode="new"
            clientId={client.value}
            today={iso(new Date())}
            invoices={invoices.map((i) => ({ id: i.id, invoiceNumber: i.invoiceNumber, dueDate: iso(i.dueDate), balance: i.balance }))}
          />
        </Section>
      )}
    </>
  );
}
