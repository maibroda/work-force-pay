"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { voidActivityAction } from "@/app/actions/sales-activities";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/toaster";

export interface TimelineRow {
  id: string;
  type: string;
  at: string;
  title: string;
  detail: string | null;
  by: string | null;
  voided: boolean;
}

const LABEL: Record<string, string> = { CALL: "Calls", MEETING: "Meetings", SITE_SURVEY: "Site surveys", WHATSAPP: "WhatsApp", EMAIL: "Emails", NOTE: "Notes", STAGE: "Stage changes", QUOTE: "Quotes", HANDOVER: "Handovers", CONSENT: "Consent" };

const when = (iso: string) => new Date(iso).toLocaleString("en-NG", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Everything about the record, newest first, with a filter by type. A mistaken activity is voided here (it stays, struck through). */
export function TimelineList({ rows, canVoid }: { rows: TimelineRow[]; canVoid: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [hidden, setHidden] = useState<string[]>([]);
  const [voiding, setVoiding] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const present = [...new Set(rows.map((r) => r.type))];
  const shown = rows.filter((r) => !hidden.includes(r.type));

  const doVoid = (id: string) =>
    start(async () => {
      const res = await voidActivityAction({ id: id.replace(/^act:/, ""), reason });
      toast(res.ok, res.ok ? (res.message ?? "Voided.") : (res.error ?? "Could not void it."));
      if (res.ok) {
        setVoiding(null);
        setReason("");
        router.refresh();
      }
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3 text-xs">
        {present.map((t) => (
          <label key={t} className="flex items-center gap-1">
            <input type="checkbox" checked={!hidden.includes(t)} onChange={() => setHidden((h) => (h.includes(t) ? h.filter((x) => x !== t) : [...h, t]))} /> {LABEL[t] ?? t}
          </label>
        ))}
      </div>
      {!shown.length && <p className="text-sm text-muted-foreground">Nothing yet.</p>}
      <ol className="space-y-2">
        {shown.map((r) => (
          <li key={r.id} className="rounded-md border p-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge>{LABEL[r.type] ?? r.type}</Badge>
              <span className={r.voided ? "line-through text-muted-foreground" : "font-medium"}>{r.title}</span>
              <span className="text-xs text-muted-foreground">
                {when(r.at)}
                {r.by ? `, ${r.by}` : ""}
              </span>
              {canVoid && r.id.startsWith("act:") && !r.voided && (
                <Button variant="outline" onClick={() => setVoiding(voiding === r.id ? null : r.id)} disabled={pending}>
                  Void
                </Button>
              )}
            </div>
            {r.detail && <p className={`mt-1 whitespace-pre-wrap text-xs ${r.voided ? "text-red-800" : "text-muted-foreground"}`}>{r.detail}</p>}
            {voiding === r.id && (
              <div className="mt-2 flex gap-2">
                <Input placeholder="Why is this a mistake?" value={reason} onChange={(e) => setReason(e.target.value)} />
                <Button onClick={() => doVoid(r.id)} disabled={pending || !reason.trim()}>
                  Void it
                </Button>
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
