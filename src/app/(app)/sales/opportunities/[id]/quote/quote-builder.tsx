"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createQuoteAction, estimateLineAction } from "@/app/actions/sales-quotes";
import type { HeadCost } from "@/lib/sales/cost-estimator";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { toast } from "@/components/toaster";

interface Row {
  siteName: string;
  postLabel: string;
  shiftPattern: string;
  salaryStructureId: string;
  headcount: string;
  requiredPersonnel: string;
  billRatePerHead: string;
  operativeSharePct: string;
  businessLine: "GUARDING" | "OUTSOURCING";
  estimate?: { cost: HeadCost; versions: { pension: string; employerCost: string }; line: { bill: string; cost: string; margin: string; marginBps: number } | null };
}

const money = (s: string) => `${Number(s) < 0 ? "-" : ""}₦${Math.abs(Number(s)).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function QuoteBuilder({ opportunityId, structures }: { opportunityId: string; structures: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const blank = (): Row => ({ siteName: "", postLabel: "", shiftPattern: "", salaryStructureId: structures[0]?.id ?? "", headcount: "1", requiredPersonnel: "", billRatePerHead: "", operativeSharePct: "", businessLine: "GUARDING" });
  const [rows, setRows] = useState<Row[]>([blank()]);
  const [validUntil, setValidUntil] = useState("");
  const [notes, setNotes] = useState("");

  // changing anything the cost depends on clears the estimate shown for that line, so it can never be stale
  const clears = (p: Partial<Row>) => "headcount" in p || "requiredPersonnel" in p || "billRatePerHead" in p || "operativeSharePct" in p || "salaryStructureId" in p || "businessLine" in p;
  const set = (i: number, patch: Partial<Row>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch, estimate: "estimate" in patch ? patch.estimate : clears(patch) ? undefined : x.estimate } : x)));

  const check = (i: number) =>
    start(async () => {
      const r = rows[i];
      const res = await estimateLineAction({ salaryStructureId: r.salaryStructureId, billRatePerHead: r.billRatePerHead, operativeSharePct: r.operativeSharePct || undefined, businessLine: r.businessLine, headcount: r.headcount, requiredPersonnel: r.requiredPersonnel || undefined });
      if (!res.ok) return toast(false, res.error ?? "Could not work out the cost.");
      set(i, { estimate: res.data as Row["estimate"] });
    });

  const save = () =>
    start(async () => {
      const res = await createQuoteAction({ opportunityId, validUntil, notes, lines: rows.map((r) => {
          const { estimate, ...line } = r;
          void estimate;
          return line;
        }) });
      toast(res.ok, res.ok ? (res.message ?? "Saved.") : (res.error ?? "Could not save the quote."));
      if (res.ok) router.push(`/sales/quotes/${(res.data as { id: string }).id}`);
    });

  return (
    <div className="space-y-4">
      {rows.map((r, i) => (
        <div key={i} className="space-y-3 rounded-md border p-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label>Site</Label>
              <Input value={r.siteName} onChange={(e) => set(i, { siteName: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Post (for example Main gate)</Label>
              <Input value={r.postLabel} onChange={(e) => set(i, { postLabel: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Shift (a label: 24/7, Day 12h)</Label>
              <Input value={r.shiftPattern} onChange={(e) => set(i, { shiftPattern: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Pay structure of the guard</Label>
              <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={r.salaryStructureId} onChange={(e) => set(i, { salaryStructureId: e.target.value })}>
                {structures.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label>Guards the client is billed for</Label>
              <Input type="number" min={1} value={r.headcount} onChange={(e) => set(i, { headcount: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>People needed to cover the shifts (blank = same as billed)</Label>
              <Input type="number" min={1} value={r.requiredPersonnel} onChange={(e) => set(i, { requiredPersonnel: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Bill rate for each guard a month (naira)</Label>
              <Input value={r.billRatePerHead} onChange={(e) => set(i, { billRatePerHead: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Share paid to the guard % (blank = 70)</Label>
              <Input type="number" min={1} max={100} value={r.operativeSharePct} onChange={(e) => set(i, { operativeSharePct: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Business line</Label>
              <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={r.businessLine} onChange={(e) => set(i, { businessLine: e.target.value as Row["businessLine"] })}>
                <option value="GUARDING">Guarding</option>
                <option value="OUTSOURCING">Outsourcing</option>
              </select>
            </div>
            <div className="flex items-end gap-2">
              <Button variant="outline" onClick={() => check(i)} disabled={pending || !r.billRatePerHead || !r.salaryStructureId}>
                Check the cost
              </Button>
              {rows.length > 1 && (
                <Button variant="outline" onClick={() => setRows((x) => x.filter((_, j) => j !== i))} disabled={pending}>
                  Remove line
                </Button>
              )}
            </div>
          </div>
          {r.estimate && (
            <dl className="grid gap-x-6 gap-y-1 rounded bg-muted/40 p-2 text-xs sm:grid-cols-3">
              <div><dt className="text-muted-foreground">Guard&apos;s monthly gross</dt><dd>{money(r.estimate.cost.gross)}</dd></div>
              <div><dt className="text-muted-foreground">Employer pension (on the pensionable pay)</dt><dd>{money(r.estimate.cost.employerPension)}</dd></div>
              <div><dt className="text-muted-foreground">ITF and NSITF</dt><dd>{money(r.estimate.cost.addOns.itf)} and {money(r.estimate.cost.addOns.nsitf)}</dd></div>
              <div><dt className="text-muted-foreground">Insurance, uniforms and kit, recruitment and training, leave reliever</dt><dd>{money(String(Number(r.estimate.cost.addOns.insurance) + Number(r.estimate.cost.addOns.uniformKits) + Number(r.estimate.cost.addOns.recruitmentTraining) + Number(r.estimate.cost.addOns.leaveReliever) + Number(r.estimate.cost.addOns.outsourcingLeaveAllowance)))}</dd></div>
              <div><dt className="text-muted-foreground">Cost of one guard a month</dt><dd className="font-medium">{money(r.estimate.cost.costPerHead)}</dd></div>
              <div><dt className="text-muted-foreground">Margin on one guard</dt><dd className="font-medium">{money(r.estimate.cost.marginPerHead)}</dd></div>
              {r.estimate.line && (
                <div className="sm:col-span-3 font-medium">
                  This line: billed {money(r.estimate.line.bill)}, cost {money(r.estimate.line.cost)} ({r.requiredPersonnel || r.headcount} people), margin {money(r.estimate.line.margin)} ({(r.estimate.line.marginBps / 100).toFixed(2)}%)
                </div>
              )}
              <div className="sm:col-span-3 text-muted-foreground">From pension rule {r.estimate.versions.pension} and employer-cost rule {r.estimate.versions.employerCost}, as in force today. Saved with the line.</div>
            </dl>
          )}
        </div>
      ))}
      <Button variant="outline" onClick={() => setRows((r) => [...r, blank()])} disabled={pending}>
        Add a line
      </Button>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label>Open until</Label>
          <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label>Notes for the client (for example: prices exclude VAT)</Label>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
      <Button onClick={save} disabled={pending || rows.some((r) => !r.siteName.trim() || !r.billRatePerHead)}>
        {pending ? "Working…" : "Save the quote as a draft"}
      </Button>
    </div>
  );
}
