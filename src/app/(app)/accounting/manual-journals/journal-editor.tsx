"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveAndSubmitAction, saveDraftAction } from "@/app/actions/journals";
import { DIMENSIONS } from "@/lib/dimensions";
import { KIND_HELP, KIND_LABELS, type JournalKind } from "@/lib/journals";
import { naira } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { toast } from "@/components/toaster";

type Opt = { value: string; label: string };
type Dims = Record<string, string>;
type Line = { accountId: string; description: string; debit: string; credit: string; dimensions: Dims };

export interface EditorInitial {
  id: string | null;
  kind: JournalKind;
  description: string;
  postingDate: string;
  reverseOn: string;
  lines: Array<{ accountId: string; description: string; debit: number; credit: number; dimensions: Dims }>;
}

const blank = (): Line => ({ accountId: "", description: "", debit: "", credit: "", dimensions: {} });
const cents = (v: string) => Math.round((Number(v) || 0) * 100);

export function JournalEditor({ initial, accounts, dimensionOptions, note }: { initial: EditorInitial; accounts: Opt[]; dimensionOptions: Record<string, Opt[]>; note?: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [kind, setKind] = useState<JournalKind>(initial.kind);
  const [description, setDescription] = useState(initial.description);
  const [postingDate, setPostingDate] = useState(initial.postingDate);
  const [reverseOn, setReverseOn] = useState(initial.reverseOn);
  const [lines, setLines] = useState<Line[]>(
    initial.lines.length
      ? initial.lines.map((l) => ({ accountId: l.accountId, description: l.description, debit: l.debit ? String(l.debit) : "", credit: l.credit ? String(l.credit) : "", dimensions: l.dimensions ?? {} }))
      : [blank(), blank()],
  );
  const [open, setOpen] = useState<number | null>(null);

  const debit = lines.reduce((s, l) => s + cents(l.debit), 0);
  const credit = lines.reduce((s, l) => s + cents(l.credit), 0);
  const diff = debit - credit;
  const update = (i: number, patch: Partial<Line>) => setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const setDim = (i: number, column: string, value: string) =>
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, dimensions: { ...l.dimensions, [column]: value } } : l)));

  const payload = () => ({
    kind,
    description,
    postingDate,
    reverseOn: kind === "ACCRUAL" ? reverseOn : "",
    linesJson: JSON.stringify(
      lines
        .filter((l) => l.accountId || cents(l.debit) || cents(l.credit))
        .map((l) => ({ accountId: l.accountId, description: l.description, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0, dimensions: Object.fromEntries(Object.entries(l.dimensions).filter(([, v]) => v)) })),
    ),
  });

  const run = (action: typeof saveDraftAction) =>
    start(async () => {
      const res = await action(initial.id, payload());
      toast(res.ok, res.ok ? (res.message ?? "Saved.") : (res.error ?? "Failed."));
      if (res.ok && res.redirectTo) {
        router.push(res.redirectTo);
        router.refresh();
      }
    });

  return (
    <div className="space-y-5 rounded-lg border bg-card p-4">
      {note && <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">Returned with this note: {note}</p>}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="kind">Kind</Label>
          <Select id="kind" value={kind} onChange={(e) => setKind(e.target.value as JournalKind)}>
            {(Object.keys(KIND_LABELS) as JournalKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </Select>
          <p className="text-xs text-muted-foreground">{KIND_HELP[kind]}</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="postingDate">Posting date *</Label>
          <Input id="postingDate" type="date" value={postingDate} onChange={(e) => setPostingDate(e.target.value)} />
        </div>
        {kind === "ACCRUAL" && (
          <div className="space-y-1">
            <Label htmlFor="reverseOn">Reverses on *</Label>
            <Input id="reverseOn" type="date" value={reverseOn} onChange={(e) => setReverseOn(e.target.value)} />
            <p className="text-xs text-muted-foreground">The reversal posts itself on this day, with no further approval.</p>
          </div>
        )}
        <div className="space-y-1 sm:col-span-3">
          <Label htmlFor="description">What it is for *</Label>
          <Input id="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Accrue September security-equipment maintenance" />
        </div>
      </div>

      <div>
        <p className="mb-2 text-sm font-medium">Lines</p>
        <div className="mb-1 hidden grid-cols-12 gap-2 px-1 text-xs text-muted-foreground sm:grid">
          <span className="col-span-4">Account</span>
          <span className="col-span-3">Narration</span>
          <span className="col-span-2 text-right">Debit</span>
          <span className="col-span-2 text-right">Credit</span>
          <span className="col-span-1" />
        </div>
        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={i} className="rounded-md border p-2">
              <div className="grid grid-cols-12 items-center gap-2">
                <Select className="col-span-12 sm:col-span-4" value={l.accountId} onChange={(e) => update(i, { accountId: e.target.value })} aria-label={`Account, line ${i + 1}`}>
                  <option value="">— Account —</option>
                  {accounts.map((a) => (
                    <option key={a.value} value={a.value}>
                      {a.label}
                    </option>
                  ))}
                </Select>
                <Input className="col-span-12 sm:col-span-3" placeholder="Narration (optional)" value={l.description} onChange={(e) => update(i, { description: e.target.value })} />
                <Input className="col-span-5 text-right sm:col-span-2" type="number" min={0} step="0.01" placeholder="Debit" value={l.debit} onChange={(e) => update(i, { debit: e.target.value, credit: e.target.value ? "" : l.credit })} />
                <Input className="col-span-5 text-right sm:col-span-2" type="number" min={0} step="0.01" placeholder="Credit" value={l.credit} onChange={(e) => update(i, { credit: e.target.value, debit: e.target.value ? "" : l.debit })} />
                <div className="col-span-2 flex justify-end gap-1 sm:col-span-1">
                  <Button type="button" size="sm" variant="ghost" onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))} disabled={lines.length <= 2} aria-label={`Remove line ${i + 1}`}>
                    ✕
                  </Button>
                </div>
              </div>
              <div className="mt-1 flex items-center gap-2 text-xs">
                <button type="button" className="text-primary underline" onClick={() => setOpen(open === i ? null : i)}>
                  {open === i ? "Hide dimensions" : "Dimensions"}
                </button>
                <span className="text-muted-foreground">{Object.values(l.dimensions).filter(Boolean).length ? `${Object.values(l.dimensions).filter(Boolean).length} set` : "none"}</span>
              </div>
              {open === i && (
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  {DIMENSIONS.map((dm) => (
                    <div key={dm.column} className="space-y-1">
                      <Label htmlFor={`d-${i}-${dm.column}`}>{dm.label}</Label>
                      <Select id={`d-${i}-${dm.column}`} value={l.dimensions[dm.column] ?? ""} onChange={(e) => setDim(i, dm.column, e.target.value)}>
                        <option value="">—</option>
                        {(dimensionOptions[dm.column] ?? []).map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </Select>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => setLines((prev) => [...prev, blank()])}>
          + Add line
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-6 border-t pt-3 text-sm">
        <span>
          Debits: <b>{naira(debit / 100)}</b>
        </span>
        <span>
          Credits: <b>{naira(credit / 100)}</b>
        </span>
        <span className={diff === 0 && debit > 0 ? "text-green-700" : "text-red-700"}>{diff === 0 ? (debit > 0 ? "Balanced" : "Nothing entered yet") : `Out by ${naira(Math.abs(diff) / 100)}`}</span>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => run(saveDraftAction)} disabled={pending}>
          {pending ? "Saving…" : "Save draft"}
        </Button>
        <Button onClick={() => run(saveAndSubmitAction)} disabled={pending}>
          Save and submit for approval
        </Button>
      </div>
    </div>
  );
}
