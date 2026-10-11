"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createPurchaseInvoiceAction } from "@/app/actions/payables";
import { naira } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { toast } from "@/components/toaster";

type Opt = { value: string; label: string };
type Line = { description: string; quantity: string; rate: string; orderLineId?: string };
export type OrderPrefill = {
  id: string;
  orderNumber: string;
  vendorId: string;
  costCenterId: string;
  description: string;
  vatPct: number;
  lines: { id: string; description: string; quantity: number; rate: number }[];
};

const emptyLine = (): Line => ({ description: "", quantity: "1", rate: "0" });

export function NewInvoiceForm({ vendors, costCenters, order }: { vendors: Opt[]; costCenters: Opt[]; order?: OrderPrefill }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [vendorId, setVendorId] = useState(order?.vendorId ?? "");
  const [vendorRef, setVendorRef] = useState("");
  const [costCenterId, setCostCenterId] = useState(order?.costCenterId ?? "");
  const [description, setDescription] = useState(order?.description ?? "");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [vatPct, setVatPct] = useState(String(order?.vatPct ?? 0));
  const [lines, setLines] = useState<Line[]>(
    order ? order.lines.map((l) => ({ description: l.description, quantity: String(l.quantity), rate: String(l.rate), orderLineId: l.id })) : [emptyLine()],
  );

  const amounts = lines.map((l) => (Number(l.quantity) || 0) * (Number(l.rate) || 0));
  const subtotal = amounts.reduce((a, b) => a + b, 0);
  const vatAmount = (subtotal * (Number(vatPct) || 0)) / 100;

  const updateLine = (i: number, patch: Partial<Line>) =>
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const submit = () =>
    start(async () => {
      const cleanLines = lines
        .filter((l) => l.description.trim() && Number(l.rate) >= 0)
        .map((l) => ({
          description: l.description,
          quantity: Number(l.quantity) || 1,
          rate: Number(l.rate),
          orderLineId: l.orderLineId,
        }));
      if (!vendorId) return toast(false, "Select a vendor.");
      if (!cleanLines.length) return toast(false, "Add at least one line item.");
      const res = await createPurchaseInvoiceAction({
        vendorId,
        vendorRef: vendorRef || undefined,
        costCenterId: costCenterId || undefined,
        description,
        invoiceDate,
        dueDate,
        vatPct: Number(vatPct) || 0,
        purchaseOrderId: order?.id,
        linesJson: JSON.stringify(cleanLines),
      });
      toast(res.ok, res.ok ? (res.message ?? "Recorded.") : (res.error ?? "Failed."));
      if (res.ok && res.redirectTo) router.push(res.redirectTo);
    });

  return (
    <div className="space-y-5 rounded-lg border bg-card p-4">
      {order && (
        <p className="rounded bg-blue-50 px-3 py-2 text-sm text-blue-900">
          Against purchase order <b>{order.orderNumber}</b>. Enter what the vendor actually billed: quantities above what was received, or prices above the order, need a second person&apos;s approval before the bill can be paid.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="vendorId">Vendor *</Label>
          <Select id="vendorId" value={vendorId} disabled={!!order} onChange={(e) => setVendorId(e.target.value)}>
            <option value="">— Select —</option>
            {vendors.map((v) => (
              <option key={v.value} value={v.value}>
                {v.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="vendorRef">Vendor&apos;s invoice/bill number</Label>
          <Input id="vendorRef" value={vendorRef} onChange={(e) => setVendorRef(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="costCenterId">Cost center</Label>
          <Select id="costCenterId" value={costCenterId} onChange={(e) => setCostCenterId(e.target.value)}>
            <option value="">— None —</option>
            {costCenters.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="description">Description *</Label>
          <Input
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Uniform batch for Q3, June utility bill…"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="vatPct">VAT %</Label>
          <Input
            id="vatPct"
            type="number"
            min={0}
            max={100}
            value={vatPct}
            onChange={(e) => setVatPct(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="invoiceDate">Invoice date *</Label>
          <Input
            id="invoiceDate"
            type="date"
            value={invoiceDate}
            onChange={(e) => setInvoiceDate(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="dueDate">Due date *</Label>
          <Input id="dueDate" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </div>
      </div>

      <div>
        <p className="mb-2 text-sm font-medium">Line items</p>
        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-12 items-center gap-2">
              <Input
                className="col-span-6"
                placeholder="Description"
                value={l.description}
                onChange={(e) => updateLine(i, { description: e.target.value })}
              />
              <Input
                className="col-span-2"
                type="number"
                min={0}
                placeholder="Qty"
                value={l.quantity}
                onChange={(e) => updateLine(i, { quantity: e.target.value })}
              />
              <Input
                className="col-span-2"
                type="number"
                min={0}
                placeholder="Rate"
                value={l.rate}
                onChange={(e) => updateLine(i, { rate: e.target.value })}
              />
              <span className="col-span-1 text-right text-xs tabular-nums">
                {naira((Number(l.quantity) || 0) * (Number(l.rate) || 0))}
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="col-span-1"
                onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}
                disabled={lines.length === 1}
              >
                ✕
              </Button>
            </div>
          ))}
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-2"
          onClick={() => setLines((prev) => [...prev, emptyLine()])}
        >
          + Add line
        </Button>
      </div>

      <div className="flex justify-end gap-6 border-t pt-3 text-sm">
        <span>
          Subtotal: <b>{naira(subtotal)}</b>
        </span>
        <span>
          VAT: <b>{naira(vatAmount)}</b>
        </span>
        <span>
          Total: <b>{naira(subtotal + vatAmount)}</b>
        </span>
      </div>

      <Button onClick={submit} disabled={pending}>
        {pending ? "Saving…" : "Record purchase invoice"}
      </Button>
    </div>
  );
}
