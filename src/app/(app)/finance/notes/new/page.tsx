import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { noteContext } from "@/server/services/client-notes";
import { NOTE_REASON_LABELS, NOTE_TYPE_HELP, NOTE_TYPE_LABELS, suggestedVat, type NoteReason, type NoteType } from "@/lib/notes";
import { fmtDate, iso } from "@/lib/dates";
import { naira } from "@/lib/money";
import { Empty, FormPanel, PageHeader, Section, KV } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { raiseNoteAction } from "@/app/actions/client-notes";

export default async function NewNotePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePage("note.manage");
  const sp = await searchParams;
  const c = sp.invoiceId ? await noteContext(ctx, sp.invoiceId).catch(() => null) : null;
  const type: NoteType = sp.type === "DEBIT" ? "DEBIT" : "CREDIT";
  return (
    <>
      <PageHeader
        title={c ? `${NOTE_TYPE_LABELS[type]} against ${c.invoice.invoiceNumber}` : "Raise a credit or debit note"}
        crumbs={[{ href: "/finance/notes", label: "Credit & debit notes" }]}
        description="Someone else has to approve it before it takes effect. Until then nothing is posted and the invoice is unchanged."
      />
      {!c && (
        <Empty>
          Notes are raised against an invoice. Open the invoice from <Link className="text-primary underline" href="/finance/invoices">Billing &amp; receivables</Link> and choose &ldquo;Raise a credit note&rdquo; or &ldquo;Raise a debit note&rdquo;.
        </Empty>
      )}
      {c && (
        <>
          <Section title="The invoice">
            <KV
              cols={4}
              items={[
                ["Client", c.invoice.clientName],
                ["Invoice date", fmtDate(c.invoice.invoiceDate)],
                ["Still owed", naira(c.facts.balance)],
                ["A credit can take off", `${naira(c.facts.netLeft)} net, ${naira(c.facts.vatLeft)} VAT`],
              ]}
            />
            <p className="mt-3 text-xs text-muted-foreground">
              VAT on this invoice is {naira(c.invoice.vatAmount)} on a net charge of {naira(c.invoice.subtotal)}, which is {c.invoice.subtotal ? ((c.invoice.vatAmount / c.invoice.subtotal) * 100).toFixed(3) : "0"}% of the net. At that rate a net of {naira(1_000_000)} carries VAT of {naira(suggestedVat(1_000_000, c.invoice.vatAmount, c.invoice.subtotal))}.
            </p>
          </Section>
          <FormPanel title={NOTE_TYPE_LABELS[type]}>
            <p className="mb-3 text-sm text-muted-foreground">{NOTE_TYPE_HELP[type]}</p>
            <SmartForm
              columns={3}
              submitLabel={`Raise ${NOTE_TYPE_LABELS[type].toLowerCase()}`}
              action={raiseNoteAction}
              fields={[
                { name: "invoiceId", label: "", type: "hidden", defaultValue: c.invoice.id },
                { name: "type", label: "", type: "hidden", defaultValue: type },
                { name: "noteDate", label: "Date of the note", type: "date", required: true, defaultValue: iso(new Date()) },
                {
                  name: "reasonCode",
                  label: "Reason",
                  type: "select",
                  required: true,
                  defaultValue: type === "CREDIT" ? "BILLING_ERROR" : "PRICE_ADJUSTMENT",
                  options: (Object.keys(NOTE_REASON_LABELS) as NoteReason[]).map((r) => ({ value: r, label: NOTE_REASON_LABELS[r] })),
                },
                { name: "netAmount", label: "Net amount", type: "number", min: 0, required: true, help: "Before VAT." },
                { name: "vatAmount", label: "VAT", type: "number", min: 0, defaultValue: 0, help: "Leave 0 if none applies." },
                { name: "reason", label: "Explanation for the client and the approver", type: "text", required: true, span: 3, placeholder: "e.g. Two guards were billed for a post that closed in June" },
              ]}
            />
          </FormPanel>
        </>
      )}
    </>
  );
}
