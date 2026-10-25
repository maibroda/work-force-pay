"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { previewClientInputsAction, submitClientInputsAction } from "@/app/actions/client-inputs";
import { INPUT_TYPE_LABELS, type InputCheck, type InputType } from "@/lib/client-inputs";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { toast } from "@/components/toaster";

type Checked = InputCheck & { sameFile: string | null; closed: string | null };
type Month = { id: string; name: string; cutoff: string | null };
const naira = (n: number) => `₦${n.toLocaleString("en-NG", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export function InputsForm({ months }: { months: Month[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [periodId, setPeriodId] = useState(months[0]?.id ?? "");
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [note, setNote] = useState("");
  const [check, setCheck] = useState<Checked | null>(null);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const month = months.find((m) => m.id === periodId);

  const run = (text: string, period: string) =>
    start(async () => {
      const res = await previewClientInputsAction({ periodId: period, csv: text });
      if (!res.ok) return toast(false, res.error ?? "Could not check the file.");
      setCheck(res.data as Checked);
    });

  const pick = (file: File | undefined) => {
    setCheck(null);
    if (!file) return;
    setFileName(file.name);
    file.text().then((text) => {
      setCsv(text);
      run(text, periodId);
    });
  };

  const send = () =>
    start(async () => {
      const res = await submitClientInputsAction({ periodId, csv, fileName, note });
      toast(res.ok, res.ok ? (res.message ?? "Sent.") : (res.error ?? "Failed."));
      if (res.ok && res.redirectTo) router.push(res.redirectTo);
    });

  if (!months.length) return <p className="text-sm text-muted-foreground">There is no open month to send inputs for. If you are expecting one, ask your payroll contact.</p>;

  const rows = check ? check.rows.filter((r) => !onlyProblems || r.errors.length || r.warnings.length) : [];
  const canSend = !!check && !check.fatal && !check.closed && !check.sameFile && check.summary.errors === 0 && check.summary.total > 0;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="month">Month</Label>
          <Select
            id="month"
            value={periodId}
            disabled={pending}
            onChange={(e) => {
              setPeriodId(e.target.value);
              if (csv) run(csv, e.target.value);
            }}
          >
            {months.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.cutoff ? ` (inputs due ${m.cutoff})` : ""}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="file">CSV file</Label>
          <Input id="file" type="file" accept=".csv,text/csv" disabled={pending} onChange={(e) => pick(e.target.files?.[0])} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">In Excel, use Save As → CSV (UTF-8). Nothing is sent until you press Send; the bureau reviews it before it reaches the payroll.</p>

      {check?.fatal && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-800">{check.fatal}</p>}
      {check?.closed && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-800">{check.closed}</p>}
      {check?.sameFile && <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-900">This exact file was already sent: {check.sameFile}.</p>}

      {check && !check.fatal && (
        <>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Badge tone="gray">{check.summary.total} rows</Badge>
            <Badge tone="green">{check.summary.ok} clean</Badge>
            <Badge tone="amber">{check.summary.warnings} with warnings</Badge>
            <Badge tone={check.summary.errors ? "red" : "green"}>{check.summary.errors} with errors</Badge>
            <span className="text-xs text-muted-foreground">
              Earnings {naira(check.summary.earnings)} · Deductions {naira(check.summary.deductions)}
            </span>
            {check.headers && check.headers.unknown.length > 0 && <span className="text-xs text-muted-foreground">Ignored columns: {check.headers.unknown.join(", ")}</span>}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} /> Show only rows with problems
          </label>
          <Table>
            <THead>
              <TR>
                <TH>Line</TH>
                <TH>Employee</TH>
                <TH>What</TH>
                <TH className="text-right">Amount</TH>
                <TH>Problems</TH>
              </TR>
            </THead>
            <TBody>
              {rows.slice(0, 300).map((r) => (
                <TR key={r.line} className={r.errors.length ? "bg-red-50/60" : ""}>
                  <TD className="font-mono text-xs">{r.line}</TD>
                  <TD className="text-xs">{r.item ? `${r.item.employeeNumber} ${r.item.employeeName}` : r.raw.employeeNumber || "—"}</TD>
                  <TD className="text-xs">{r.item ? `${INPUT_TYPE_LABELS[r.item.type as InputType]}: ${r.item.description}` : r.raw.type || "—"}</TD>
                  <TD className="text-right text-xs">{r.item ? naira(r.item.amount) : r.raw.amount || "—"}</TD>
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

          <div className="space-y-1">
            <Label htmlFor="note">A note for the bureau (optional)</Label>
            <Input id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Includes the late overtime from the Ikeja site" />
          </div>
          {month?.cutoff && new Date().toISOString().slice(0, 10) > month.cutoff && <p className="text-xs text-amber-700">The cut-off for {month.name} was {month.cutoff}. You can still send this; the bureau will see that it is late.</p>}
          <Button onClick={send} disabled={pending || !canSend}>
            {pending ? "Working…" : canSend ? `Send ${check.summary.total} input(s) to the bureau` : "Send to the bureau"}
          </Button>
          {check.summary.errors > 0 && <p className="text-xs text-muted-foreground">Fix the errors in the file and choose it again. A file with any error is not sent, so nothing is half-done.</p>}
        </>
      )}
    </div>
  );
}
