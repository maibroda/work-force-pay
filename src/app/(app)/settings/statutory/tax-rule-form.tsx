"use client";
import { SmartForm } from "@/components/smart-form";
import { createTaxRuleAction } from "@/app/actions/payroll";
import { filingDefaultsFor } from "@/lib/paye-dates";

type Current = { code: string; name: string; payeDueDay: number | null; annualReturnMonth: number | null; annualReturnDay: number | null; latePenaltyPct: number | null; bands: string; reliefs: unknown[]; exemptions: unknown[] };

export function TaxRuleForm({ current }: { current: Current }) {
  const timing = filingDefaultsFor({ dueDay: current.payeDueDay, annualReturnMonth: current.annualReturnMonth, annualReturnDay: current.annualReturnDay, latePenaltyPct: current.latePenaltyPct });
  const note = timing.proposed ? "Starting value from the founder's PAYE file, NOT yet verified by the tax adviser: change or clear it" : "Carried over from the current version";
  return (
    <SmartForm
      columns={3}
      fields={[
        { name: "code", label: "Rule code", required: true, defaultValue: current.code },
        { name: "name", label: "Name", required: true, defaultValue: current.name },
        { name: "version", label: "New version", required: true, placeholder: "2027.1" },
        { name: "effectiveFrom", label: "Effective from", type: "date", required: true },
        { name: "legalBasis", label: "Legal basis / source", span: 2 },
        // Filing dates and the penalty are statutory values: leave blank until the tax adviser confirms them (carried over from the current version).
        { name: "payeDueDay", label: "PAYE due day (of the next month)", type: "number", min: 1, max: 28, defaultValue: timing.dueDay ?? undefined, help: note },
        { name: "annualReturnMonth", label: "Annual return month (1-12)", type: "number", min: 1, max: 12, defaultValue: timing.annualReturnMonth ?? undefined, help: note },
        { name: "annualReturnDay", label: "Annual return day", type: "number", min: 1, max: 31, defaultValue: timing.annualReturnDay ?? undefined },
        { name: "latePenaltyPct", label: "Late penalty (% of unremitted PAYE)", type: "number", min: 0, max: 100, defaultValue: timing.latePenaltyPct ?? undefined, help: `${note}. Interest is not calculated` },
        {
          name: "bands",
          label: "Bands — one per line: lower,upper,rate% (blank upper = no limit)",
          type: "textarea",
          required: true,
          defaultValue: current.bands,
          span: 3,
        },
      ]}
      action={async (v) => {
        const bands = String(v.bands ?? "")
          .split(/\n/)
          .map((l) => l.trim())
          .filter(Boolean)
          .map((l) => {
            const [lo, up, rate] = l.split(",").map((s) => s.trim());
            return { lowerBound: Number(lo), upperBound: up ? Number(up) : null, rate: Number(rate) };
          });
        return createTaxRuleAction({ ...v, bands, reliefs: current.reliefs, exemptions: current.exemptions });
      }}
      submitLabel="Create version"
    />
  );
}
