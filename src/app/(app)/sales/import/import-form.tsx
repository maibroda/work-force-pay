"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { commitSalesImportAction, previewSalesImportAction } from "@/app/actions/sales-import";
import { rowLabel, type ImportKind } from "@/lib/sales/import";
import type { ImportPreview } from "@/server/services/sales/import";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { toast } from "@/components/toaster";

const KINDS: { value: ImportKind; label: string }[] = [
  { value: "LEADS", label: "Leads" },
  { value: "ACCOUNTS", label: "Accounts" },
  { value: "CONTACTS", label: "Contacts (import their accounts first)" },
];

export function SalesImportForm() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [kind, setKind] = useState<ImportKind>("LEADS");
  const [csv, setCsv] = useState("");
  const [result, setResult] = useState<{ preview: ImportPreview; errorsCsv: string } | null>(null);
  const [skipErrors, setSkipErrors] = useState(false);
  const [importDuplicates, setImportDuplicates] = useState(false);
  const [onlyProblems, setOnlyProblems] = useState(true);

  const pick = (file: File | undefined) => {
    setResult(null);
    if (!file) return;
    start(async () => {
      const text = await file.text();
      setCsv(text);
      const res = await previewSalesImportAction({ kind, csv: text });
      if (!res.ok) return toast(false, res.error ?? "Could not check the file.");
      setResult(res.data as { preview: ImportPreview; errorsCsv: string });
    });
  };

  const commit = () =>
    start(async () => {
      const res = await commitSalesImportAction({ kind, csv, skipErrors, importDuplicates });
      toast(res.ok, res.ok ? (res.message ?? "Imported.") : (res.error ?? "Failed."));
      if (res.ok) {
        setResult(null);
        setCsv("");
        router.push(kind === "LEADS" ? "/sales/leads" : kind === "ACCOUNTS" ? "/sales/accounts" : "/sales/contacts");
      }
    });

  const check = result?.preview.check;
  const dupes = result?.preview.duplicates ?? {};
  const isDup = (line: number) => !!dupes[line] && (dupes[line].visible.length > 0 || dupes[line].hidden > 0);
  const rows = check ? check.rows.filter((r) => !onlyProblems || r.errors.length || r.warnings.length || isDup(r.line)) : [];
  const clean = check ? check.rows.filter((r) => r.data) : [];
  const duplicateCount = clean.filter((r) => isDup(r.line)).length;
  const importable = clean.length - (importDuplicates ? 0 : duplicateCount);
  const canCommit = !!check && !check.fatal && importable > 0 && (check.summary.errors === 0 || skipErrors);
  const errorsHref = result?.errorsCsv ? `data:text/csv;charset=utf-8,${encodeURIComponent(`﻿${result.errorsCsv}`)}` : null;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="kind">What is in the file</Label>
          <select
            id="kind"
            className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            value={kind}
            disabled={pending}
            onChange={(e) => {
              setKind(e.target.value as ImportKind);
              setResult(null);
              setCsv("");
            }}
          >
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
          <a className="text-xs underline" href={`/api/sales/import-template/${kind.toLowerCase()}`}>
            Download the {kind.toLowerCase()} template
          </a>
        </div>
        <div className="space-y-1">
          <Label htmlFor="file">CSV file</Label>
          <Input id="file" type="file" accept=".csv,text/csv" disabled={pending} onChange={(e) => pick(e.target.files?.[0])} />
          <p className="text-xs text-muted-foreground">In Excel, use Save As, CSV (UTF-8). Nothing is saved until you press Import. The file is not kept.</p>
        </div>
      </div>

      {check?.fatal && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-800">{check.fatal}</p>}

      {check && !check.fatal && (
        <>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Badge tone="gray">{check.summary.total} rows</Badge>
            <Badge tone="green">{check.summary.ok} clean</Badge>
            <Badge tone="amber">{check.summary.warnings} with warnings</Badge>
            <Badge tone={check.summary.errors ? "red" : "green"}>{check.summary.errors} with errors</Badge>
            <Badge tone={duplicateCount ? "amber" : "green"}>{duplicateCount} look already held</Badge>
            {check.headers && check.headers.unknown.length > 0 && <span className="text-xs text-muted-foreground">Ignored columns: {check.headers.unknown.join(", ")}</span>}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} /> Show only rows with problems
          </label>
          <Table>
            <THead>
              <TR>
                <TH>Line</TH>
                <TH>Row</TH>
                <TH>Problems</TH>
              </TR>
            </THead>
            <TBody>
              {rows.slice(0, 300).map((r) => (
                <TR key={r.line} className={r.errors.length ? "bg-red-50/60" : ""}>
                  <TD className="font-mono text-xs">{r.line}</TD>
                  <TD className="text-xs">{rowLabel(kind, r)}</TD>
                  <TD className="whitespace-normal text-xs">
                    {r.errors.map((e, i) => (
                      <p key={`e${i}`} className="text-red-700">
                        ✕ {e}
                      </p>
                    ))}
                    {r.warnings.map((w, i) => (
                      <p key={`w${i}`} className="text-amber-700">
                        ! {w}
                      </p>
                    ))}
                    {dupes[r.line]?.visible.map((d, i) => (
                      <p key={`d${i}`} className="text-amber-700">
                        ! Looks already held: {d}
                      </p>
                    ))}
                    {dupes[r.line]?.hidden ? (
                      <p className="text-amber-700">! Looks like {dupes[r.line].hidden} record(s) owned by someone else. Ask them or a manager.</p>
                    ) : null}
                    {!r.errors.length && !r.warnings.length && !isDup(r.line) && <span className="text-emerald-700">✓ OK</span>}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          {rows.length > 300 && <p className="text-xs text-muted-foreground">Showing the first 300 of {rows.length}.</p>}

          {errorsHref && check.summary.errors > 0 && (
            <a className="text-sm underline" href={errorsHref} download={`${kind.toLowerCase()}-rows-to-correct.csv`}>
              Download the {check.summary.errors} row(s) with errors, with what is wrong, to correct and upload again
            </a>
          )}
          {check.summary.errors > 0 && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={skipErrors} onChange={(e) => setSkipErrors(e.target.checked)} />
              Import the rows without errors and leave the {check.summary.errors} with errors out
            </label>
          )}
          {duplicateCount > 0 && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={importDuplicates} onChange={(e) => setImportDuplicates(e.target.checked)} />
              Import anyway the {duplicateCount} row(s) that look already held (otherwise they are left out)
            </label>
          )}
          <Button onClick={commit} disabled={pending || !canCommit}>
            {pending ? "Working…" : `Import ${importable} row(s)`}
          </Button>
        </>
      )}
    </div>
  );
}
