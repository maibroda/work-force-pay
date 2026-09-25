"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createPurchaseOrderAction } from "@/app/actions/purchase-orders";
import { naira } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { toast } from "@/components/toaster";

type Opt = { value: string; label: string };
type Line = { description: string; quantity: string; rate: string };

const emptyLine = (): Line => ({ description: "", quantity: "1", rate: "0" });

export function NewOrderForm({ vendors, costCenters }: { vendors: Opt[]; costCenters: Opt[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [vendorId, setVendorId] = useState("");
  const [costCenterId, setCostCenterId] = useState("");
  const [description, setDescription] = useState("");
  const [vatPct, setVatPct] = useState("0");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([emptyLine()]);

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
        }));
      if (!vendorId) return toast(false, "Select a vendor.");
      if (!cleanLines.length) return toast(false, "Add at least one line item.");
      const res = await createPurchaseOrderAction({
        vendorId,
        costCenterId: costCenterId || undefined,
        description,
        vatPct: Number(vatPct) || 0,
        notes: notes || undefined,
        linesJson: JSON.stringify(cleanLines),
      });
      toast(res.ok, res.ok ? (res.message ?? "Created.") : (res.error ?? "Failed."));
      if (res.ok && res.redirectTo) router.push(res.redirectTo);
    });

  return (
    <div className="space-y-5 rounded-lg border bg-card p-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="vendorId">Vendor *</Label>
          <Select id="vendorId" value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
            <option value="">— Select —</option>
            {vendors.map((v) => (
              <option key={v.value} value={v.value}>
                {v.label}
              </option>
            ))}
          </Select>
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
        <div className="space-y-1 sm:col-span-3">
          <Label htmlFor="description">Description *</Label>
          <Input
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Radios for the new Lekki deployment"
          />
        </div>
        <div className="space-y-1 sm:col-span-3">
          <Label htmlFor="notes">Notes</Label>
          <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
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
        {pending ? "Saving…" : "Create purchase order"}
      </Button>
    </div>
  );
}
