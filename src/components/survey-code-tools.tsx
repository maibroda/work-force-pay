"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/action-result";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PrintButton } from "@/components/print-button";
import { toast } from "@/components/toaster";

type SheetRow = { employeeNumber: string; name: string; code: string };

/**
 * Opening a survey makes one access code for each invited employee. The sheet is shown ONCE, here, to print and hand out; the server keeps only hashes, so it cannot be
 * shown again. Closing this page loses it (a lost code is reissued for that one person).
 */
export function OpenSurveyWithSheet({ open }: { open: () => Promise<ActionResult> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [sheet, setSheet] = useState<SheetRow[] | null>(null);
  if (sheet)
    return (
      <div className="space-y-3">
        <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          This sheet is shown <b>once</b>. Print it now and give each person their own code, privately. Anyone with a code can answer once, with no login, on a phone, a shared device or an assisted session.
        </p>
        <div className="print:hidden">
          <PrintButton />
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className="p-1">Employee</th>
              <th className="p-1">Name</th>
              <th className="p-1">Access code</th>
            </tr>
          </thead>
          <tbody>
            {sheet.map((r) => (
              <tr key={r.employeeNumber} className="border-t">
                <td className="p-1">{r.employeeNumber}</td>
                <td className="p-1">{r.name}</td>
                <td className="p-1 font-mono">{r.code}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Button
          variant="outline"
          onClick={() => {
            setSheet(null);
            router.refresh();
          }}
        >
          I have printed it: close the sheet
        </Button>
      </div>
    );
  return (
    <Button
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await open();
          toast(res.ok, res.ok ? (res.message ?? "Done.") : (res.error ?? "Failed."));
          const data = res.data as { sheet?: SheetRow[] } | undefined;
          if (res.ok && data?.sheet) setSheet(data.sheet);
          else if (res.ok) router.refresh();
        })
      }
    >
      Open the survey and make the access codes
    </Button>
  );
}

/** A lost code: reissue it for one person by employee number. The new code is shown once. */
export function ReissueCode({ reissue }: { reissue: (v: Record<string, unknown>) => Promise<ActionResult> }) {
  const [pending, start] = useTransition();
  const [number, setNumber] = useState("");
  const [code, setCode] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs">
          Employee number
          <Input className="mt-1 h-9 w-48" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="e.g. EMP-000012" />
        </label>
        <Button
          variant="outline"
          disabled={pending || !number.trim()}
          onClick={() =>
            start(async () => {
              const res = await reissue({ employeeNumber: number });
              toast(res.ok, res.ok ? "New code made." : (res.error ?? "Failed."));
              const data = res.data as { code?: string } | undefined;
              setCode(res.ok && data?.code ? data.code : null);
            })
          }
        >
          Reissue a lost code
        </Button>
      </div>
      {code && (
        <p className="text-sm">
          New code (shown once): <b className="font-mono">{code}</b>
        </p>
      )}
    </div>
  );
}
