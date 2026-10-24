"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { commitEmployeeImportAction, previewEmployeeImportAction } from "@/app/actions/employee-import";
import type { ImportCheck } from "@/lib/employee-import";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { toast } from "@/components/toaster";

export function ImportForm() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [check, setCheck] = useState<ImportCheck | null>(null);
  const [skipErrors, setSkipErrors] = useState(false);
  const [onlyProblems, setOnlyProblems] = useState(true);

  const pick = (file: File | undefined) => {
    setCheck(null);
    if (!file) return;
    setFileName(file.name);
    start(async () => {
      const text = await file.text();
      setCsv(text);
      const res = await previewEmployeeImportAction({ csv: text });
      if (!res.ok) return toast(false, res.error ?? "Could not check the file.");
      setCheck(res.data as ImportCheck);
    });
  };

  const commit = () =>
    start(async () => {
      const res = await commitEmployeeImportAction({ csv, fileName, skipErrors });
      toast(res.ok, res.ok ? (res.message ?? "Imported.") : (res.error ?? "Failed."));
      if (res.ok) {
        setCheck(null);
        setCsv("");
        setFileName("");
        router.push("/employees");
      }
    });

  const rows = check ? check.rows.filter((r) => !onlyProblems || r.errors.length || r.warnings.length) : [];
  const importable = check ? check.summary.total - check.summary.errors : 0;
  const canCommit = !!check && !check.fatal && importable > 0 && (check.summary.errors === 0 || skipErrors);

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="file">CSV file</Label>
        <Input id="file" type="file" accept=".csv,text/csv" disabled={pending} onChange={(e) => pick(e.target.files?.[0])} />
        <p className="text-xs text-muted-foreground">In Excel, use Save As → CSV (UTF-8). Nothing is saved until you press Import.</p>
      </div>

      {check?.fatal && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-800">{check.fatal}</p>}

      {check && !check.fatal && (
        <>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Badge tone="gray">{check.summary.total} rows</Badge>
            <Badge tone="green">{check.summary.ok} clean</Badge>
            <Badge tone="amber">{check.summary.warnings} with warnings</Badge>
            <Badge tone={check.summary.errors ? "red" : "green"}>{check.summary.errors} with errors</Badge>
            {check.headers && check.headers.unknown.length > 0 && (
              <span className="text-xs text-muted-foreground">Ignored columns: {check.headers.unknown.join(", ")}</span>
            )}
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} /> Show only rows with problems
          </label>

          <Table>
            <THead>
              <TR>
                <TH>Line</TH>
                <TH>Name</TH>
                <TH>Problems</TH>
              </TR>
            </THead>
            <TBody>
              {rows.slice(0, 300).map((r) => (
                <TR key={r.line} className={r.errors.length ? "bg-red-50/60" : ""}>
                  <TD className="font-mono text-xs">{r.line}</TD>
                  <TD className="text-xs">{`${r.raw.firstName ?? ""} ${r.raw.lastName ?? ""}`.trim() || "—"}</TD>
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
                    {!r.errors.length && !r.warnings.length && <span className="text-emerald-700">✓ OK</span>}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          {rows.length > 300 && <p className="text-xs text-muted-foreground">Showing the first 300 of {rows.length}.</p>}

          {check.summary.errors > 0 && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={skipErrors} onChange={(e) => setSkipErrors(e.target.checked)} />
              Import the {importable} row(s) without errors and leave the {check.summary.errors} with errors out
            </label>
          )}
          <Button onClick={commit} disabled={pending || !canCommit}>
            {pending ? "Working…" : `Import ${importable} employee(s)`}
          </Button>
          {check.summary.errors > 0 && !skipErrors && (
            <p className="text-xs text-muted-foreground">Fix the errors in the file and upload it again, or tick the box above to import only the rows that are right.</p>
          )}
        </>
      )}
    </div>
  );
}
