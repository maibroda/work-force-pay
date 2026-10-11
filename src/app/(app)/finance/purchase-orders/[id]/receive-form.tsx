"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { recordGoodsReceiptAction } from "@/app/actions/matching";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { toast } from "@/components/toaster";

type Line = { id: string; description: string; open: number };

export function ReceiveForm({ orderId, lines, today }: { orderId: string; lines: Line[]; today: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [receivedDate, setReceivedDate] = useState(today);
  const [deliveryNote, setDeliveryNote] = useState("");
  const [notes, setNotes] = useState("");
  const [qty, setQty] = useState<Record<string, string>>(Object.fromEntries(lines.map((l) => [l.id, String(l.open)])));

  const submit = () =>
    start(async () => {
      const chosen = lines.filter((l) => Number(qty[l.id]) > 0).map((l) => ({ orderLineId: l.id, quantity: Number(qty[l.id]) }));
      if (!chosen.length) return toast(false, "Enter a quantity for at least one line.");
      const res = await recordGoodsReceiptAction({ orderId, receivedDate, deliveryNote, notes, linesJson: JSON.stringify(chosen) });
      toast(res.ok, res.ok ? (res.message ?? "Recorded.") : (res.error ?? "Failed."));
      if (res.ok) router.refresh();
    });

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="receivedDate">Date received *</Label>
          <Input id="receivedDate" type="date" max={today} value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="deliveryNote">Delivery note / waybill no.</Label>
          <Input id="deliveryNote" value={deliveryNote} onChange={(e) => setDeliveryNote(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="grnNotes">Notes (condition, shortfalls…)</Label>
          <Input id="grnNotes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
      <div className="space-y-2">
        {lines.map((l) => (
          <div key={l.id} className="grid grid-cols-12 items-center gap-2 text-sm">
            <span className="col-span-8">{l.description}</span>
            <span className="col-span-2 text-right text-xs text-muted-foreground">{l.open} outstanding</span>
            <Input
              className="col-span-2"
              type="number"
              min={0}
              max={l.open}
              step="any"
              aria-label={`Received: ${l.description}`}
              value={qty[l.id]}
              onChange={(e) => setQty((p) => ({ ...p, [l.id]: e.target.value }))}
            />
          </div>
        ))}
      </div>
      <Button onClick={submit} disabled={pending}>
        {pending ? "Saving…" : "Record goods received"}
      </Button>
    </div>
  );
}
