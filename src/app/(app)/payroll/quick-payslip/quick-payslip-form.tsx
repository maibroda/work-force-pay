"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { naira } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";

export interface StructurePreset {
  id: string;
  name: string;
  basicPct: number;
  housingPct: number;
  transportPct: number;
  othersPct: number;
}

export interface QuickValues {
  gross: string;
  payDate: string;
  basicPct: string;
  housingPct: string;
  transportPct: string;
  structureId: string;
  annualRent: string;
  deductionName: string;
  deductionAmount: string;
  employeeName: string;
  position: string;
}

/** The inputs of a quick payslip, with the "other allowances" share shown live as whatever the other three leave. */
export function QuickPayslipForm({ initial, structures }: { initial: QuickValues; structures: StructurePreset[] }) {
  const router = useRouter();
  const [v, setV] = useState<QuickValues>(initial);
  const set = (k: keyof QuickValues, value: string) => setV((p) => ({ ...p, [k]: value }));
  const pct = (s: string) => Number(s) || 0;
  const other = Math.round((100 - pct(v.basicPct) - pct(v.housingPct) - pct(v.transportPct)) * 10000) / 10000;
  const gross = Number(v.gross) || 0;
  const amountOf = (p: number) => (gross * p) / 100;

  const applyPreset = (id: string) => {
    const s = structures.find((x) => x.id === id);
    setV((p) => (s ? { ...p, structureId: id, basicPct: String(s.basicPct), housingPct: String(s.housingPct), transportPct: String(s.transportPct) } : { ...p, structureId: "" }));
  };
  const go = () => {
    const q = new URLSearchParams();
    for (const [k, val] of Object.entries(v)) if (val !== "") q.set(k, val);
    router.push(`/payroll/quick-payslip?${q.toString()}`);
  };

  const row = (label: string, key: "basicPct" | "housingPct" | "transportPct") => (
    <div className="space-y-1">
      <Label htmlFor={key}>{label} %</Label>
      <Input id={key} type="number" min={0} max={100} step="0.01" value={v[key]} onChange={(e) => set(key, e.target.value)} />
      <p className="text-xs text-muted-foreground">{gross ? naira(amountOf(pct(v[key]))) : "of the gross"}</p>
    </div>
  );

  return (
    <div className="space-y-5 rounded-lg border bg-card p-4 print:hidden">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="gross">Monthly gross salary *</Label>
          <Input id="gross" type="number" min={0} step="0.01" value={v.gross} onChange={(e) => set("gross", e.target.value)} placeholder="e.g. 500000" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="payDate">Pay date</Label>
          <Input id="payDate" type="date" value={v.payDate} onChange={(e) => set("payDate", e.target.value)} />
          <p className="text-xs text-muted-foreground">Decides which tax and pension rules apply.</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="structureId">Start from a salary structure</Label>
          <Select id="structureId" value={v.structureId} onChange={(e) => applyPreset(e.target.value)}>
            <option value="">— None: set the percentages below —</option>
            {structures.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.basicPct}/{s.housingPct}/{s.transportPct}, others {s.othersPct})
              </option>
            ))}
          </Select>
          <p className="text-xs text-muted-foreground">Fills the percentages and splits the other allowances the way the structure does.</p>
        </div>
      </div>

      <div>
        <p className="mb-2 text-sm font-medium">How the gross is split</p>
        <div className="grid gap-4 sm:grid-cols-4">
          {row("Basic", "basicPct")}
          {row("Housing", "housingPct")}
          {row("Transport", "transportPct")}
          <div className="space-y-1">
            <Label>Other allowances %</Label>
            <div className={`flex h-10 items-center rounded-md border px-3 text-sm ${other < 0 ? "border-red-300 bg-red-50 text-red-800" : "bg-muted/40"}`}>{other}%</div>
            <p className={`text-xs ${other < 0 ? "text-red-700" : "text-muted-foreground"}`}>{other < 0 ? "Basic, Housing and Transport are over 100%" : gross ? naira(amountOf(other)) : "whatever the other three leave"}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <div className="space-y-1">
          <Label htmlFor="annualRent">Annual rent paid (optional)</Label>
          <Input id="annualRent" type="number" min={0} step="0.01" value={v.annualRent} onChange={(e) => set("annualRent", e.target.value)} />
          <p className="text-xs text-muted-foreground">Only used if the tax rule gives rent relief.</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="deductionName">Other deduction</Label>
          <Input id="deductionName" value={v.deductionName} onChange={(e) => set("deductionName", e.target.value)} placeholder="e.g. Staff loan" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="deductionAmount">Deduction amount</Label>
          <Input id="deductionAmount" type="number" min={0} step="0.01" value={v.deductionAmount} onChange={(e) => set("deductionAmount", e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="employeeName">Name on the slip (optional)</Label>
          <Input id="employeeName" value={v.employeeName} onChange={(e) => set("employeeName", e.target.value)} />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="position">Position (optional)</Label>
          <Input id="position" value={v.position} onChange={(e) => set("position", e.target.value)} />
        </div>
      </div>

      <Button onClick={go} disabled={!gross || other < 0}>
        Generate payslip
      </Button>
    </div>
  );
}
