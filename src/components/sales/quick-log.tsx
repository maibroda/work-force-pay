"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createTaskAction, logActivityAction } from "@/app/actions/sales-activities";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { toast } from "@/components/toaster";

export interface LogTarget {
  leadId?: string;
  accountId?: string;
  contactId?: string;
  opportunityId?: string;
}

const KINDS = [
  { value: "CALL", label: "Log a call" },
  { value: "MEETING", label: "Log a meeting" },
  { value: "SITE_SURVEY", label: "Log a site survey" },
  { value: "WHATSAPP", label: "Log a WhatsApp" },
  { value: "NOTE", label: "Add a note" },
  { value: "TASK", label: "Create a task" },
] as const;

const sel = "h-9 w-full rounded-md border bg-background px-2 text-sm";

/** One small form for everything a salesperson writes down. Marketing messages to someone who has not agreed are refused by the server. */
export function QuickLog({ target, managers }: { target: LogTarget; managers?: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [kind, setKind] = useState<(typeof KINDS)[number]["value"]>("CALL");
  const [f, setF] = useState<Record<string, string>>({});
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  const field = (k: string, label: string, props: { type?: string; placeholder?: string } = {}) => (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Input type={props.type} placeholder={props.placeholder} value={f[k] ?? ""} onChange={(e) => set(k, e.target.value)} />
    </div>
  );

  const submit = () =>
    start(async () => {
      const res = kind === "TASK" ? await createTaskAction({ ...target, ...f }) : await logActivityAction({ ...target, ...f, kind });
      toast(res.ok, res.ok ? (res.message ?? "Saved.") : (res.error ?? "Could not save."));
      if (res.ok) {
        setF({});
        router.refresh();
      }
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {KINDS.map((k) => (
          <Button key={k.value} variant={kind === k.value ? "default" : "outline"} onClick={() => (setKind(k.value), setF({}))}>
            {k.label}
          </Button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {kind === "CALL" && (
          <>
            <div className="space-y-1">
              <Label>How did it go?</Label>
              <select className={sel} value={f.callOutcome ?? ""} onChange={(e) => set("callOutcome", e.target.value)}>
                <option value="">— choose —</option>
                <option value="REACHED">Reached them</option>
                <option value="NO_ANSWER">No answer</option>
                <option value="CALLBACK">Call back later</option>
                <option value="WRONG_NUMBER">Wrong number</option>
              </select>
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label>What was said (optional)</Label>
              <Textarea rows={2} value={f.body ?? ""} onChange={(e) => set("body", e.target.value)} />
            </div>
          </>
        )}
        {kind === "MEETING" && (
          <>
            {field("subject", "What the meeting was about")}
            <div className="space-y-1 sm:col-span-2">
              <Label>Notes (optional)</Label>
              <Textarea rows={2} value={f.body ?? ""} onChange={(e) => set("body", e.target.value)} />
            </div>
          </>
        )}
        {kind === "SITE_SURVEY" && (
          <>
            {field("siteType", "Site type (estate, office, factory...)")}
            {field("entryPoints", "Number of entry points", { type: "number" })}
            {field("existingGuards", "Guards already there", { type: "number" })}
            <div className="space-y-1 sm:col-span-2">
              <Label>Risk notes</Label>
              <Textarea rows={2} value={f.riskNotes ?? ""} onChange={(e) => set("riskNotes", e.target.value)} />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label>Photo links (up to 10, one per line: this app stores no files)</Label>
              <Textarea rows={2} value={f.photoLinks ?? ""} onChange={(e) => set("photoLinks", e.target.value)} />
            </div>
          </>
        )}
        {kind === "WHATSAPP" && (
          <>
            <div className="space-y-1">
              <Label>This message is</Label>
              <select className={sel} value={f.purpose ?? ""} onChange={(e) => set("purpose", e.target.value)}>
                <option value="">— choose —</option>
                <option value="SERVICE">A service message (about an active contract)</option>
                <option value="MARKETING">Marketing (needs their consent)</option>
              </select>
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label>What it said</Label>
              <Textarea rows={2} value={f.body ?? ""} onChange={(e) => set("body", e.target.value)} />
            </div>
          </>
        )}
        {kind === "NOTE" && (
          <div className="space-y-1 sm:col-span-2">
            <Label>Note</Label>
            <Textarea rows={3} value={f.body ?? ""} onChange={(e) => set("body", e.target.value)} />
          </div>
        )}
        {kind === "TASK" && (
          <>
            {field("title", "What has to be done")}
            {field("dueAt", "Due (Lagos time)", { type: "datetime-local" })}
            {field("reminderAt", "Remind me (optional)", { type: "datetime-local" })}
            {managers && managers.length > 0 && (
              <div className="space-y-1">
                <Label>Give it to</Label>
                <select className={sel} value={f.ownerUserId ?? ""} onChange={(e) => set("ownerUserId", e.target.value)}>
                  <option value="">Me</option>
                  {managers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="space-y-1 sm:col-span-2">
              <Label>Notes (optional)</Label>
              <Textarea rows={2} value={f.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
            </div>
          </>
        )}
      </div>
      <Button onClick={submit} disabled={pending}>
        {pending ? "Saving…" : kind === "TASK" ? "Add the task" : "Save"}
      </Button>
    </div>
  );
}
