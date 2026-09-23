"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/action-result";
import { Select } from "@/components/ui/input";
import { toast } from "./toaster";

/** A select that saves itself on change — for reclassifying a single field without a full edit form. */
export function InlineSelect({
  value,
  options,
  action,
  disabled,
  className,
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  action: (value: string) => Promise<ActionResult>;
  disabled?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (disabled)
    return <span className="text-xs">{options.find((o) => o.value === value)?.label ?? value}</span>;
  return (
    <Select
      className={className ?? "h-8 w-auto text-xs"}
      value={value}
      disabled={pending}
      onChange={(e) => {
        const next = e.target.value;
        start(async () => {
          const r = await action(next);
          toast(r.ok, r.ok ? (r.message ?? "Saved.") : (r.error ?? "Failed."));
          if (r.ok) router.refresh();
        });
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}
