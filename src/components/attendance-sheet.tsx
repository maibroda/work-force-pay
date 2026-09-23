"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { toast } from "./toaster";
import type { ActionResult } from "@/lib/action-result";

const STATUSES = ["PRESENT", "LATE", "ABSENT", "LEAVE", "OFF", "SUSPENDED"] as const;

/** Mark attendance for every employee deployed at a beat on a date (attendance is recorded against the LOCATION). */
export function AttendanceSheet({
  beatId,
  date,
  staff,
  action,
  compact,
}: {
  beatId: string;
  date: string;
  staff: Array<{ employeeId: string; employeeNumber: string; name: string; status: string | null }>;
  action: (entries: Array<Record<string, unknown>>) => Promise<ActionResult>;
  compact?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(staff.map((s) => [s.employeeId, s.status ?? "PRESENT"])),
  );
  const save = () =>
    start(async () => {
      const r = await action(
        staff.map((s) => ({ employeeId: s.employeeId, beatId, date, status: values[s.employeeId] })),
      );
      toast(r.ok, r.ok ? (r.message ?? "Saved") : (r.error ?? "Failed"));
      if (r.ok) router.refresh();
    });
  if (!staff.length)
    return <p className="py-3 text-sm text-muted-foreground">No employees deployed here on this date.</p>;
  return (
    <div className="space-y-2">
      <ul className="divide-y rounded-md border">
        {staff.map((s) => (
          <li key={s.employeeId} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
            <span className="min-w-0">
              <span className="font-mono text-xs text-muted-foreground">{s.employeeNumber}</span>{" "}
              <span className="truncate">{s.name}</span>
              {!s.status && !compact && (
                <span className="ml-2 text-[11px] text-amber-700">not yet recorded</span>
              )}
            </span>
            <Select
              aria-label={`Status for ${s.employeeNumber}`}
              className="h-8 w-32 text-xs"
              value={values[s.employeeId]}
              onChange={(e) => setValues((v) => ({ ...v, [s.employeeId]: e.target.value }))}
            >
              {STATUSES.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </Select>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          type="button"
          onClick={() => setValues(Object.fromEntries(staff.map((s) => [s.employeeId, "PRESENT"])))}
        >
          All present
        </Button>
        <Button size="sm" type="button" disabled={pending} onClick={save}>
          {pending ? "Saving…" : "Save attendance"}
        </Button>
      </div>
    </div>
  );
}

/**
 * Fast monthly attendance entry: "days in month" is fixed by the calendar month; "days worked"
 * defaults to that and is adjusted down to how many days the employee actually worked (e.g. August
 * — 31 days in the month, 17 days worked). The first N working days are marked PRESENT, the rest
 * ABSENT; approved leave days are left untouched.
 */
export function MonthlyAttendanceSheet({
  beatId,
  year,
  month,
  daysInMonth,
  staff,
  action,
}: {
  beatId: string;
  year: number;
  month: number;
  daysInMonth: number;
  staff: Array<{ employeeId: string; employeeNumber: string; name: string }>;
  action: (
    beatId: string,
    year: number,
    month: number,
    rows: Array<{ employeeId: string; daysWorked: number }>,
  ) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [values, setValues] = useState<Record<string, number>>(() =>
    Object.fromEntries(staff.map((s) => [s.employeeId, daysInMonth])),
  );
  const save = () =>
    start(async () => {
      const r = await action(
        beatId,
        year,
        month,
        staff.map((s) => ({ employeeId: s.employeeId, daysWorked: values[s.employeeId] })),
      );
      toast(r.ok, r.ok ? (r.message ?? "Saved") : (r.error ?? "Failed"));
      if (r.ok) router.refresh();
    });
  if (!staff.length)
    return <p className="py-3 text-sm text-muted-foreground">No employees deployed here this month.</p>;
  return (
    <div className="space-y-2">
      <ul className="divide-y rounded-md border">
        <li className="flex items-center justify-between gap-2 bg-muted/40 px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
          <span>Employee</span>
          <span className="flex gap-4">
            <span className="w-20 text-center">Days in month</span>
            <span className="w-24 text-center">Days worked</span>
          </span>
        </li>
        {staff.map((s) => (
          <li key={s.employeeId} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
            <span className="min-w-0">
              <span className="font-mono text-xs text-muted-foreground">{s.employeeNumber}</span>{" "}
              <span className="truncate">{s.name}</span>
            </span>
            <span className="flex items-center gap-4">
              <span className="w-20 text-center text-xs text-muted-foreground">{daysInMonth}</span>
              <input
                type="number"
                min={0}
                max={daysInMonth}
                aria-label={`Days worked for ${s.employeeNumber}`}
                className="h-8 w-24 rounded-md border border-input bg-card px-2 text-center text-sm shadow-sm"
                value={values[s.employeeId]}
                onChange={(e) =>
                  setValues((v) => ({
                    ...v,
                    [s.employeeId]: Math.max(0, Math.min(daysInMonth, Number(e.target.value))),
                  }))
                }
              />
            </span>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          type="button"
          onClick={() => setValues(Object.fromEntries(staff.map((s) => [s.employeeId, daysInMonth])))}
        >
          Reset to full month
        </Button>
        <Button size="sm" type="button" disabled={pending} onClick={save}>
          {pending ? "Saving…" : "Save monthly attendance"}
        </Button>
      </div>
    </div>
  );
}
