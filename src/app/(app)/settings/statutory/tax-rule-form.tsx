"use client";
import { SmartForm } from "@/components/smart-form";
import { createTaxRuleAction } from "@/app/actions/payroll";

type Current = { code: string; name: string; bands: string; reliefs: unknown[]; exemptions: unknown[] };

export function TaxRuleForm({ current }: { current: Current }) {
  return (
    <SmartForm
      columns={3}
      fields={[
        { name: "code", label: "Rule code", required: true, defaultValue: current.code },
        { name: "name", label: "Name", required: true, defaultValue: current.name },
        { name: "version", label: "New version", required: true, placeholder: "2027.1" },
        { name: "effectiveFrom", label: "Effective from", type: "date", required: true },
        { name: "legalBasis", label: "Legal basis / source", span: 2 },
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
