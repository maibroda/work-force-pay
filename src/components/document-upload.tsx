"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { toast } from "./toaster";

export interface UploadType {
  id: string;
  name: string;
  category: string;
  categoryLabel: string;
  hasExpiry: boolean;
}

const EXTENSIONS = ["pdf", "doc", "docx", "jpg", "jpeg", "png"];
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 10;

const sizeText = (n: number) => (n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** The browser's quick check, for a faster answer only: the server checks the type, size and contents of every file again. */
function quickCheck(f: File): string | null {
  const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
  if (!EXTENSIONS.includes(ext)) return "Only PDF, DOC, DOCX, JPG, JPEG, PNG files can be uploaded.";
  if (f.size === 0) return "The file is empty.";
  if (f.size > MAX_BYTES) return "The file is larger than 10 MB.";
  return null;
}

/**
 * Upload one or several files for an employee (each becomes its own document), or one replacement file for an existing document.
 * Drag and drop or choose files; progress is shown while they upload; each file gets its own success or error.
 */
export function DocumentUpload({
  employeeId,
  types,
  replaceDocumentId,
  fixedTypeId,
  needsType = false,
  onDone,
}: {
  employeeId: string;
  types: UploadType[];
  /** Replace this document's file instead of adding a new document (one file). */
  replaceDocumentId?: string;
  fixedTypeId?: string;
  /** A record from before document management: the type must be chosen. */
  needsType?: boolean;
  onDone?: () => void;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [typeId, setTypeId] = useState(fixedTypeId ?? "");
  const [over, setOver] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [results, setResults] = useState<Array<{ name: string; ok: boolean; error?: string }>>([]);
  const replacing = !!replaceDocumentId;
  const showType = !replacing || needsType;
  const type = types.find((t) => t.id === typeId);
  const busy = progress !== null;

  const add = (list: FileList | File[]) => {
    const picked = Array.from(list);
    setResults([]);
    setFiles((cur) => (replacing ? picked.slice(0, 1) : [...cur, ...picked].slice(0, MAX_FILES)));
  };

  /** One file in one request, so a large or refused file never holds up the others. */
  const sendOne = (file: File, fields: FormData, onLoaded: (loaded: number) => void) =>
    new Promise<{ name: string; ok: boolean; error?: string }>((resolve) => {
      const body = new FormData();
      for (const [k, v] of fields.entries()) body.append(k, v);
      body.append("file", file);
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/documents/upload");
      xhr.responseType = "json";
      xhr.upload.onprogress = (ev) => onLoaded(ev.loaded);
      xhr.onerror = () => resolve({ name: file.name, ok: false, error: "The upload could not be completed. Check your connection and try again." });
      xhr.onload = () => {
        const r = xhr.response as { results?: Array<{ name: string; ok: boolean; error?: string }>; error?: string } | null;
        resolve(r?.results?.[0] ?? { name: file.name, ok: false, error: r?.error ?? "The upload was refused." });
      };
      xhr.send(body);
    });

  const send = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    if (!files.length) return toast(false, "Choose at least one file.");
    if (showType && !typeId) return toast(false, "Choose the type of document.");
    const bad = files.map((f) => ({ f, why: quickCheck(f) })).find((x) => x.why);
    if (bad) return toast(false, `${bad.f.name}: ${bad.why}`);
    const fields = new FormData();
    fields.set("employeeId", employeeId);
    if (typeId) fields.set("typeId", typeId);
    if (replaceDocumentId) fields.set("documentId", replaceDocumentId);
    for (const k of ["description", "reference", "issueDate", "expiryDate"]) {
      const v = form.get(k);
      if (typeof v === "string" && v) fields.set(k, v);
    }
    const total = files.reduce((a, f) => a + f.size, 0);
    let done = 0;
    const out: Array<{ name: string; ok: boolean; error?: string }> = [];
    setProgress(0);
    for (const f of files) {
      out.push(await sendOne(f, fields, (loaded) => setProgress(Math.min(100, Math.round(((done + loaded) / total) * 100)))));
      done += f.size;
    }
    setProgress(null);
    setResults(out);
    const ok = out.filter((x) => x.ok).length;
    const failed = out.length - ok;
    if (ok) {
      toast(true, `${ok} ${ok === 1 ? "file" : "files"} uploaded${replacing ? " as a new version" : ""}.`);
      setFiles(files.filter((f) => out.find((x) => x.name === f.name && !x.ok)));
      router.refresh();
      onDone?.();
    }
    if (failed) toast(false, `${failed} ${failed === 1 ? "file was" : "files were"} refused: see the list below.`);
  };

  return (
    <form onSubmit={send} className="space-y-4">
      {showType && (
        <div className="max-w-md">
          <Label htmlFor={`type-${replaceDocumentId ?? "new"}`}>Type of document *</Label>
          <Select id={`type-${replaceDocumentId ?? "new"}`} value={typeId} onChange={(e) => setTypeId(e.target.value)} disabled={busy}>
            <option value="">— Select —</option>
            {Array.from(new Set(types.map((t) => t.category))).map((c) => (
              <optgroup key={c} label={types.find((t) => t.category === c)!.categoryLabel}>
                {types.filter((t) => t.category === c).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </div>
      )}

      <div
        role="button"
        tabIndex={0}
        aria-label="Drop files here or press to choose files"
        onClick={() => input.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (!busy) add(e.dataTransfer.files);
        }}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed px-4 py-6 text-center text-sm ${over ? "border-primary bg-accent" : "border-muted-foreground/30"}`}
      >
        <span className="font-medium">Drag and drop {replacing ? "the new file" : "files"} here, or choose {replacing ? "a file" : "files"}</span>
        <span className="mt-1 text-xs text-muted-foreground">PDF, DOC, DOCX, JPG, JPEG or PNG, up to 10 MB each{replacing ? "" : `, up to ${MAX_FILES} at a time (each becomes its own document)`}</span>
        <input ref={input} type="file" className="hidden" multiple={!replacing} accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" onChange={(e) => e.target.files && add(e.target.files)} />
      </div>

      {files.length > 0 && (
        <ul className="divide-y rounded-md border text-sm">
          {files.map((f, i) => {
            const why = quickCheck(f);
            const server = results.find((r) => r.name === f.name && !r.ok);
            return (
              <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="min-w-0 truncate">
                  {f.name} <span className="text-xs text-muted-foreground">({sizeText(f.size)})</span>
                  {(why || server) && <span className="ml-2 text-xs text-red-700">{why ?? server?.error}</span>}
                </span>
                {!busy && (
                  <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))}>
                    Remove
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`ref-${replaceDocumentId ?? "new"}`}>Document reference number (optional)</Label>
          <Input id={`ref-${replaceDocumentId ?? "new"}`} name="reference" disabled={busy || replacing} />
        </div>
        <div>
          <Label htmlFor={`issue-${replaceDocumentId ?? "new"}`}>Issue date (optional)</Label>
          <Input id={`issue-${replaceDocumentId ?? "new"}`} name="issueDate" type="date" disabled={busy || replacing} />
        </div>
        {(type?.hasExpiry || !showType) && !replacing && (
          <div>
            <Label htmlFor="expiry-new">Expiry date{type?.hasExpiry ? "" : " (optional)"}</Label>
            <Input id="expiry-new" name="expiryDate" type="date" disabled={busy} />
          </div>
        )}
        {!replacing && (
          <div className="sm:col-span-2">
            <Label htmlFor="desc-new">Description or comments (optional)</Label>
            <Textarea id="desc-new" name="description" rows={2} disabled={busy} />
          </div>
        )}
      </div>

      {busy && (
        <div aria-live="polite">
          <div className="h-2 w-full overflow-hidden rounded bg-secondary">
            <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Uploading… {progress}%</p>
        </div>
      )}

      <Button type="submit" disabled={busy || !files.length}>
        {busy ? "Uploading…" : replacing ? "Upload the new version" : files.length > 1 ? `Upload ${files.length} documents` : "Upload document"}
      </Button>

      {results.length > 0 && (
        <ul className="space-y-1 text-sm" aria-live="polite">
          {results.map((r, i) => (
            <li key={`${r.name}-${i}`} className={r.ok ? "text-green-700" : "text-red-700"}>
              {r.ok ? "Uploaded" : "Refused"}: {r.name}
              {r.error ? ` — ${r.error}` : ""}
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
