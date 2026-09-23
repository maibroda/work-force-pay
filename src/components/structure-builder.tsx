"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Trash2 } from "lucide-react";
import type { ActionResult } from "@/lib/action-result";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { toast } from "./toaster";

const component = z.object({
  code: z
    .string()
    .trim()
    .min(2, "Code")
    .regex(/^[A-Za-z][A-Za-z0-9_]*$/, "Letters/digits/_"),
  name: z.string().trim().min(2, "Name"),
  calcType: z.enum(["PERCENTAGE", "FIXED_AMOUNT", "FORMULA"]),
  percentage: z.string().optional(),
  fixedAmount: z.string().optional(),
  formula: z.string().optional(),
  taxable: z.boolean(),
  pensionable: z.boolean(),
  employerCost: z.boolean(),
  active: z.boolean(),
});
const schema = z.object({
  code: z.string().trim().min(2, "Structure code is required"),
  name: z.string().trim().min(3, "Structure name is required"),
  description: z.string().optional(),
  calculationMethod: z.enum(["PERCENTAGE_OF_GROSS", "MIXED"]),
  isPartial: z.boolean(),
  effectiveFrom: z.string().min(10, "Effective from is required"),
  effectiveTo: z.string().optional(),
  activate: z.boolean(),
  components: z.array(component).min(1, "Add at least one component"),
});
export type BuilderValues = z.infer<typeof schema>;

export const DEFAULT_TEMPLATE: BuilderValues["components"] = [
  ["BASIC", "Basic", "10", true],
  ["HOUSING", "Housing", "14", true],
  ["TRANSPORT", "Transport", "15", true],
  ["ENTERTAINMENT", "Entertainment", "5", false],
  ["MEAL", "Meal", "15", false],
  ["UTILITY", "Utility", "20", false],
  ["LEAVE", "Leave", "2.5", false],
  ["MEDICAL", "Medical", "5", false],
  ["CLOTHING", "Clothing", "13.5", false],
].map(([code, name, pct, pen]) => ({
  code: String(code),
  name: String(name),
  calcType: "PERCENTAGE" as const,
  percentage: String(pct),
  fixedAmount: "",
  formula: "",
  taxable: true,
  pensionable: Boolean(pen),
  employerCost: false,
  active: true,
}));

export function StructureBuilder({
  initial,
  action,
  submitLabel = "Save structure",
}: {
  initial?: Partial<BuilderValues>;
  action: (v: never) => Promise<ActionResult>;
  submitLabel?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const form = useForm<BuilderValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      code: "",
      name: "",
      description: "",
      calculationMethod: "PERCENTAGE_OF_GROSS",
      isPartial: false,
      effectiveFrom: new Date().toISOString().slice(0, 10),
      effectiveTo: "",
      activate: true,
      components: DEFAULT_TEMPLATE,
      ...initial,
    },
  });
  const { fields, append, remove, replace } = useFieldArray({ control: form.control, name: "components" });
  const comps = form.watch("components");
  const isPartial = form.watch("isPartial");
  const total = comps
    .filter((c) => c.active && c.calcType === "PERCENTAGE")
    .reduce((a, c) => a + (Number(c.percentage) || 0), 0);
  const totalOk = isPartial || Math.abs(total - 100) < 0.0001;
  const errs = form.formState.errors;

  const onSubmit = form.handleSubmit((v) => {
    const payload = {
      ...v,
      effectiveTo: v.effectiveTo || undefined,
      components: v.components.map((c) => ({
        ...c,
        percentage: c.percentage ? Number(c.percentage) : null,
        fixedAmount: c.fixedAmount ? Number(c.fixedAmount) : null,
        formula: c.formula || null,
      })),
    };
    start(async () => {
      const r = await action(payload as never);
      toast(r.ok, r.ok ? (r.message ?? "Saved") : (r.error ?? "Failed"));
      if (r.ok) {
        if (r.redirectTo) router.push(r.redirectTo);
        else router.refresh();
      }
    });
  });

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label>Structure name *</Label>
          <Input {...form.register("name")} placeholder="ABC Bank Guard Structure" />
          {errs.name && <p className="text-[11px] text-destructive">{errs.name.message}</p>}
        </div>
        <div className="space-y-1">
          <Label>Structure code *</Label>
          <Input {...form.register("code")} placeholder="ABC-GUARD" disabled={Boolean(initial?.code)} />
          {errs.code && <p className="text-[11px] text-destructive">{errs.code.message}</p>}
        </div>
        <div className="space-y-1">
          <Label>Calculation method</Label>
          <Select {...form.register("calculationMethod")}>
            <option value="PERCENTAGE_OF_GROSS">Percentage of gross</option>
            <option value="MIXED">Mixed (percent + fixed / formula)</option>
          </Select>
        </div>
        <div className="space-y-1 sm:col-span-3">
          <Label>Description</Label>
          <Input {...form.register("description")} />
        </div>
        <div className="space-y-1">
          <Label>Effective from *</Label>
          <Input type="date" {...form.register("effectiveFrom")} />
          {errs.effectiveFrom && <p className="text-[11px] text-destructive">{errs.effectiveFrom.message}</p>}
        </div>
        <div className="space-y-1">
          <Label>Effective to</Label>
          <Input type="date" {...form.register("effectiveTo")} />
        </div>
        <div className="flex flex-col justify-end gap-1 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" {...form.register("isPartial")} /> PARTIAL structure (100% not required)
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" {...form.register("activate")} /> Activate on save (Status ACTIVE)
          </label>
        </div>
      </div>

      <div className="rounded-md border">
        <div className="flex items-center justify-between border-b bg-muted/50 px-3 py-2">
          <span className="text-sm font-semibold">Salary components</span>
          <span className="flex gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => replace(DEFAULT_TEMPLATE)}>
              Load default template
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                append({
                  code: "",
                  name: "",
                  calcType: "PERCENTAGE",
                  percentage: "",
                  fixedAmount: "",
                  formula: "",
                  taxable: true,
                  pensionable: false,
                  employerCost: false,
                  active: true,
                })
              }
            >
              <Plus className="h-3.5 w-3.5" /> Add component
            </Button>
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="p-2">Code</th>
                <th className="p-2">Name</th>
                <th className="p-2">Type</th>
                <th className="p-2">% / Amount / Formula</th>
                <th className="p-2 text-center">Taxable</th>
                <th className="p-2 text-center">Pensionable</th>
                <th className="p-2 text-center">Employer cost</th>
                <th className="p-2 text-center">Active</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {fields.map((f, i) => {
                const t = comps[i]?.calcType;
                return (
                  <tr key={f.id} className="border-t">
                    <td className="p-1.5">
                      <Input
                        className="h-8 w-32 font-mono text-xs uppercase"
                        {...form.register(`components.${i}.code`)}
                      />
                    </td>
                    <td className="p-1.5">
                      <Input className="h-8 w-36 text-xs" {...form.register(`components.${i}.name`)} />
                    </td>
                    <td className="p-1.5">
                      <Select className="h-8 w-36 text-xs" {...form.register(`components.${i}.calcType`)}>
                        <option value="PERCENTAGE">PERCENTAGE</option>
                        <option value="FIXED_AMOUNT">FIXED_AMOUNT</option>
                        <option value="FORMULA">FORMULA</option>
                      </Select>
                    </td>
                    <td className="p-1.5">
                      {t === "PERCENTAGE" && (
                        <Input
                          className="h-8 w-24 text-xs"
                          type="number"
                          step="any"
                          {...form.register(`components.${i}.percentage`)}
                          placeholder="%"
                        />
                      )}
                      {t === "FIXED_AMOUNT" && (
                        <Input
                          className="h-8 w-32 text-xs"
                          type="number"
                          step="any"
                          {...form.register(`components.${i}.fixedAmount`)}
                          placeholder="₦ per month"
                        />
                      )}
                      {t === "FORMULA" && (
                        <Input
                          className="h-8 w-56 font-mono text-xs"
                          {...form.register(`components.${i}.formula`)}
                          placeholder="MIN(GROSS * 2%, 3000)"
                        />
                      )}
                    </td>
                    {(["taxable", "pensionable", "employerCost", "active"] as const).map((k) => (
                      <td key={k} className="p-1.5 text-center">
                        <input type="checkbox" aria-label={k} {...form.register(`components.${i}.${k}`)} />
                      </td>
                    ))}
                    <td className="p-1.5">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label="Remove"
                        onClick={() => remove(i)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div
          className={`flex items-center justify-between border-t px-3 py-2 text-sm ${totalOk ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-900"}`}
        >
          <span>
            Percentage total: <b>{total.toFixed(2)}%</b>
          </span>
          <span>
            {totalOk
              ? isPartial
                ? "Partial structure — 100% not required"
                : "✓ Totals 100%"
              : "Salary structure percentages must total 100%."}
          </span>
        </div>
        {errs.components && (
          <p className="px-3 pb-2 text-[11px] text-destructive">
            Check component rows — code and name are required.
          </p>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Formula variables: <code>GROSS</code> (operative monthly gross) and any earlier component code, e.g.{" "}
        <code>BASIC * 10%</code>. Functions: MIN, MAX, ROUND.
      </p>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}
