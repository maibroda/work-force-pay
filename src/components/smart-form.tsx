"use client";
/**
 * Generic form: React Hook Form + a Zod schema built from the field config for instant client
 * validation. The server action re-validates with the service-layer Zod schema (authoritative).
 */
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "./toaster";

export interface Field {
  name: string;
  label: string;
  type?: "text" | "number" | "date" | "select" | "textarea" | "checkbox" | "hidden" | "email" | "password";
  options?: Array<{ value: string; label: string }>;
  required?: boolean;
  min?: number;
  max?: number;
  pattern?: string;
  patternMessage?: string;
  placeholder?: string;
  help?: string;
  defaultValue?: string | number | boolean;
  span?: 1 | 2 | 3;
}

function buildSchema(fields: Field[]) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of fields) {
    if (f.type === "checkbox") {
      shape[f.name] = z.boolean().optional();
      continue;
    }
    let s: z.ZodTypeAny = z.string();
    if (f.required) s = (s as z.ZodString).trim().min(1, `${f.label} is required`);
    if (f.pattern)
      s = (s as z.ZodString).refine(
        (v) => !v || new RegExp(f.pattern!).test(v),
        f.patternMessage ?? `${f.label} is invalid`,
      );
    if (f.type === "email")
      s = (s as z.ZodString).refine((v) => !v || /.+@.+\..+/.test(v), "Enter a valid email");
    if (f.type === "number")
      s = (s as z.ZodString).refine(
        (v) =>
          v === "" ||
          (!Number.isNaN(Number(v)) &&
            (f.min === undefined || Number(v) >= f.min) &&
            (f.max === undefined || Number(v) <= f.max)),
        `${f.label} must be a number${f.min !== undefined ? ` ≥ ${f.min}` : ""}${f.max !== undefined ? ` and ≤ ${f.max}` : ""}`,
      );
    shape[f.name] = f.required ? s : s.optional();
  }
  return z.object(shape);
}

export function SmartForm({
  fields,
  action,
  submitLabel = "Save",
  columns = 2,
  resetOnSuccess = true,
  className,
}: {
  fields: Field[];
  action: (values: Record<string, unknown>) => Promise<ActionResult>;
  submitLabel?: string;
  columns?: 1 | 2 | 3;
  resetOnSuccess?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const schema = useMemo(() => buildSchema(fields), [fields]);
  const defaults = useMemo(
    () =>
      Object.fromEntries(
        fields.map((f) => [
          f.name,
          f.type === "checkbox"
            ? Boolean(f.defaultValue)
            : f.defaultValue === undefined
              ? ""
              : String(f.defaultValue),
        ]),
      ),
    [fields],
  );
  const form = useForm<Record<string, unknown>>({ resolver: zodResolver(schema), defaultValues: defaults });
  const errors = form.formState.errors;

  const onSubmit = form.handleSubmit((values) => {
    setServerError(null);
    const clean = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v === "" ? undefined : v]));
    start(async () => {
      const r = await action(clean);
      if (r.ok) {
        toast(true, r.message ?? "Saved.");
        if (resetOnSuccess) form.reset(defaults);
        if (r.redirectTo) router.push(r.redirectTo);
        else router.refresh();
      } else {
        setServerError(r.error ?? "Failed.");
        toast(false, r.error ?? "Failed.");
      }
    });
  });

  const grid = columns === 1 ? "sm:grid-cols-1" : columns === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2";
  return (
    <form onSubmit={onSubmit} className={cn("space-y-4", className)} noValidate>
      <div className={cn("grid grid-cols-1 gap-3", grid)}>
        {fields.map((f) => {
          if (f.type === "hidden") return <input key={f.name} type="hidden" {...form.register(f.name)} />;
          const err = errors[f.name]?.message as string | undefined;
          const span = f.span === 3 ? "sm:col-span-3" : f.span === 2 ? "sm:col-span-2" : "";
          return (
            <div
              key={f.name}
              className={cn(
                "space-y-1",
                span,
                f.type === "textarea" && columns > 1 && !f.span ? "sm:col-span-2" : "",
              )}
            >
              {f.type === "checkbox" ? (
                <label className="flex items-center gap-2 pt-5 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-input"
                    {...form.register(f.name)}
                  />
                  {f.label}
                </label>
              ) : (
                <>
                  <Label htmlFor={f.name}>
                    {f.label}
                    {f.required && <span className="text-destructive"> *</span>}
                  </Label>
                  {f.type === "select" ? (
                    <Select id={f.name} {...form.register(f.name)} aria-invalid={Boolean(err)}>
                      <option value="">— Select —</option>
                      {f.options?.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                  ) : f.type === "textarea" ? (
                    <Textarea id={f.name} placeholder={f.placeholder} {...form.register(f.name)} />
                  ) : (
                    <Input
                      id={f.name}
                      type={f.type === "number" ? "number" : (f.type ?? "text")}
                      step={f.type === "number" ? "any" : undefined}
                      placeholder={f.placeholder}
                      aria-invalid={Boolean(err)}
                      {...form.register(f.name)}
                    />
                  )}
                </>
              )}
              {f.help && !err && <p className="text-[11px] text-muted-foreground">{f.help}</p>}
              {err && <p className="text-[11px] text-destructive">{err}</p>}
            </div>
          );
        })}
      </div>
      {serverError && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {serverError}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "Working…" : submitLabel}
      </Button>
    </form>
  );
}
