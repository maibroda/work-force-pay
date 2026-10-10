"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { applyAdvanceAction, recordClientReceiptAction } from "@/app/actions/receipts";
import { autoAllocate } from "@/lib/receipts";
import { naira } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { toast } from "@/components/toaster";

export interface EditorInvoice {
  id: string;
  invoiceNumber: string;
  dueDate: string;
  balance: number;
}

const cents = (v: string) => Math.round((Number(v) || 0) * 100);

/**
 * Records a client receipt with its allocation to invoices (mode "new"), or applies what a receipt is holding to invoices
 * (mode "apply"). Shows what is applied, what is held as an advance, and what is left to apply as it is filled in.
 */
export function ReceiptEditor({
  mode,
  clientId,
  receiptId,
  invoices,
  today,
  available,
}: {
  mode: "new" | "apply";
  clientId: string;
  receiptId?: string;
  invoices: EditorInvoice[];
  today: string;
  available?: { cash: number; wht: number };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [amount, setAmount] = useState("");
  const [receivedDate, setReceivedDate] = useState(today);
  const [method, setMethod] = useState("Bank transfer");
  const [reference, setReference] = useState("");
  const [wht, setWht] = useState("");
  const [whtReference, setWhtReference] = useState("");
  const [notes, setNotes] = useState("");
  const [appliedOn, setAppliedOn] = useState(today);
  const [cash, setCash] = useState<Record<string, string>>({});
  const [tax, setTax] = useState<Record<string, string>>({});

  const cashTotal = invoices.reduce((s, i) => s + cents(cash[i.id] ?? ""), 0);
  const taxTotal = invoices.reduce((s, i) => s + cents(tax[i.id] ?? ""), 0);
  const cashGiven = mode === "new" ? cents(amount) : cents(String(available?.cash ?? 0));
  const taxGiven = mode === "new" ? cents(wht) : cents(String(available?.wht ?? 0));
  const held = cashGiven - cashTotal;
  const taxLeft = taxGiven - taxTotal;

  const fill = () => {
    const rows = autoAllocate(invoices.map((i) => ({ id: i.id, invoiceNumber: i.invoiceNumber, dueDate: new Date(i.dueDate), balance: i.balance })), cashGiven / 100, taxGiven / 100);
    setCash(Object.fromEntries(rows.filter((r) => r.cash).map((r) => [r.invoiceId, String(r.cash)])));
    setTax(Object.fromEntries(rows.filter((r) => r.wht).map((r) => [r.invoiceId, String(r.wht)])));
  };
  const linesJson = () =>
    JSON.stringify(invoices.map((i) => ({ invoiceId: i.id, cash: Number(cash[i.id]) || 0, wht: Number(tax[i.id]) || 0 })).filter((a) => a.cash || a.wht));

  const submit = () =>
    start(async () => {
      const res =
        mode === "new"
          ? await recordClientReceiptAction({ clientId, amount, receivedDate, method, reference, whtWithheld: wht || 0, whtReference, notes, linesJson: linesJson() })
          : await applyAdvanceAction(receiptId!, { appliedOn, linesJson: linesJson() });
      toast(res.ok, res.ok ? (res.message ?? "Saved.") : (res.error ?? "Failed."));
      if (res.ok && res.redirectTo) {
        router.push(res.redirectTo);
        router.refresh();
      }
    });

  return (
    <div className="space-y-5 rounded-lg border bg-card p-4">
      {mode === "new" ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="amount">Cash received *</Label>
            <Input id="amount" type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="receivedDate">Date received *</Label>
            <Input id="receivedDate" type="date" max={today} value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="method">Method</Label>
            <Input id="method" value={method} onChange={(e) => setMethod(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="reference">Bank reference</Label>
            <Input id="reference" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. the transfer reference" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="wht">Tax the client withheld</Label>
            <Input id="wht" type="number" min={0} step="0.01" value={wht} onChange={(e) => setWht(e.target.value)} />
            <p className="text-xs text-muted-foreground">Not cash, but it settles the invoices. Apply all of it below.</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="whtReference">Withholding credit note / certificate no.</Label>
            <Input id="whtReference" value={whtReference} onChange={(e) => setWhtReference(e.target.value)} disabled={!cents(wht)} />
          </div>
          <div className="space-y-1 sm:col-span-3">
            <Label htmlFor="notes">Notes</Label>
            <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="appliedOn">Apply on</Label>
            <Input id="appliedOn" type="date" max={today} value={appliedOn} onChange={(e) => setAppliedOn(e.target.value)} />
          </div>
          <p className="self-end text-sm text-muted-foreground sm:col-span-2">
            Held to apply: cash {naira(cashGiven / 100)}
            {taxGiven ? `, tax withheld ${naira(taxGiven / 100)}` : ""}.
          </p>
        </div>
      )}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-medium">Apply to invoices</p>
          <Button type="button" size="sm" variant="outline" onClick={fill} disabled={!cashGiven && !taxGiven}>
            Oldest first
          </Button>
        </div>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Invoice</th>
                <th className="px-3 py-2 text-left">Due</th>
                <th className="px-3 py-2 text-right">Owed</th>
                <th className="px-3 py-2 text-right">Cash applied</th>
                <th className="px-3 py-2 text-right">Tax withheld applied</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.id} className="border-t">
                  <td className="px-3 py-1.5 font-mono text-xs">{i.invoiceNumber}</td>
                  <td className="px-3 py-1.5 text-xs">{i.dueDate}</td>
                  <td className="px-3 py-1.5 text-right">{naira(i.balance)}</td>
                  <td className="px-3 py-1.5 text-right">
                    <Input className="ml-auto w-36 text-right" type="number" min={0} step="0.01" value={cash[i.id] ?? ""} onChange={(e) => setCash({ ...cash, [i.id]: e.target.value })} aria-label={`Cash applied to ${i.invoiceNumber}`} />
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <Input className="ml-auto w-36 text-right" type="number" min={0} step="0.01" value={tax[i.id] ?? ""} onChange={(e) => setTax({ ...tax, [i.id]: e.target.value })} disabled={!taxGiven} aria-label={`Tax withheld applied to ${i.invoiceNumber}`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!invoices.length && <p className="px-3 py-3 text-sm text-muted-foreground">This client has no invoices that still owe anything. Whatever is received is held as an advance.</p>}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-6 border-t pt-3 text-sm">
        <span>
          Cash applied: <b>{naira(cashTotal / 100)}</b>
        </span>
        <span className={held < 0 ? "text-red-700" : "text-muted-foreground"}>{held < 0 ? `Over by ${naira(-held / 100)}` : `Held as an advance: ${naira(held / 100)}`}</span>
        {taxGiven > 0 && (
          <span className={taxLeft === 0 ? "text-green-700" : "text-amber-700"}>
            Tax withheld: {naira(taxTotal / 100)} of {naira(taxGiven / 100)} applied
          </span>
        )}
      </div>

      <Button onClick={submit} disabled={pending || (mode === "new" ? cashGiven <= 0 : cashTotal + taxTotal <= 0)}>
        {pending ? "Saving…" : mode === "new" ? "Record receipt" : "Apply"}
      </Button>
    </div>
  );
}
