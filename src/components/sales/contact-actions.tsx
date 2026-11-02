"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { logLinkUseAction, sendEmailAction } from "@/app/actions/sales-activities";
import { defaultWhatsAppText, telLink, waLink } from "@/lib/sales/activity";
import { whatsappFooter } from "@/lib/sales/whatsapp";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { toast } from "@/components/toaster";

export interface PersonLinks {
  /** Whom a logged call, WhatsApp or email is about. */
  target: { contactId?: string; leadId?: string; opportunityId?: string };
  firstName: string | null;
  company: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  sender: string;
  /** This person's own unsubscribe page address; a marketing WhatsApp ends with it. Empty when the app cannot make one. */
  unsubscribeUrl: string | null;
}

const sel = "h-9 w-full rounded-md border bg-background px-2 text-sm";

/**
 * Call, WhatsApp and email without any third-party service. Using the call or WhatsApp button logs it FIRST, and the link opens only if that succeeded, so a marketing WhatsApp
 * to someone who has not agreed is refused before anything opens. Email is sent through the app's own email channel and logged.
 */
export function ContactActions({ p }: { p: PersonLinks }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [text, setText] = useState(defaultWhatsAppText({ firstName: p.firstName, company: p.company, sender: p.sender }));
  const [purpose, setPurpose] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [emailPurpose, setEmailPurpose] = useState("");
  // a marketing WhatsApp always ends with the person's unsubscribe link (the server refuses one without it)
  const outgoing = purpose === "MARKETING" && p.unsubscribeUrl && !text.includes(p.unsubscribeUrl) ? text + whatsappFooter(p.unsubscribeUrl) : text;
  const wa = waLink(p.whatsapp ?? p.phone, outgoing);
  const tel = telLink(p.phone);

  const call = () =>
    start(async () => {
      const res = await logLinkUseAction({ ...p.target, kind: "CALL" });
      toast(res.ok, res.ok ? "Call logged. Write up how it went afterwards." : (res.error ?? "Could not log the call."));
      if (res.ok && tel) window.location.href = tel;
      router.refresh();
    });
  const whatsapp = () =>
    start(async () => {
      const res = await logLinkUseAction({ ...p.target, kind: "WHATSAPP", purpose, body: outgoing });
      toast(res.ok, res.ok ? "Logged. Opening WhatsApp." : (res.error ?? "Could not log the message."));
      if (res.ok && wa) window.open(wa, "_blank", "noopener");
      router.refresh();
    });
  const email = () =>
    start(async () => {
      const res = await sendEmailAction({ ...p.target, subject, body, purpose: emailPurpose });
      toast(res.ok, res.ok ? (res.message ?? "Sent.") : (res.error ?? "Could not send."));
      if (res.ok) {
        setSubject("");
        setBody("");
        router.refresh();
      }
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {tel ? (
          <Button variant="outline" onClick={call} disabled={pending}>
            Call {p.phone}
          </Button>
        ) : (
          <span className="text-muted-foreground">No phone number on file.</span>
        )}
      </div>
      {wa && (
        <div className="space-y-2 rounded-md border p-3">
          <h3 className="text-sm font-semibold">WhatsApp</h3>
          <div className="space-y-1">
            <Label>Message (edit it before it opens)</Label>
            <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} />
            {purpose === "MARKETING" && <p className="text-xs text-muted-foreground">The person&apos;s unsubscribe link is added at the end.</p>}
          </div>
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <select className={sel} value={purpose} onChange={(e) => setPurpose(e.target.value)}>
              <option value="">This message is… (choose)</option>
              <option value="SERVICE">A service message (about an active contract)</option>
              <option value="MARKETING">Marketing (needs their consent)</option>
            </select>
            <Button onClick={whatsapp} disabled={pending || !purpose}>
              Log and open WhatsApp
            </Button>
          </div>
        </div>
      )}
      {p.email && (
        <div className="space-y-2 rounded-md border p-3">
          <h3 className="text-sm font-semibold">Email to {p.email}</h3>
          <Input placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          <Textarea rows={4} placeholder="Message" value={body} onChange={(e) => setBody(e.target.value)} />
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <select className={sel} value={emailPurpose} onChange={(e) => setEmailPurpose(e.target.value)}>
              <option value="">This message is… (choose)</option>
              <option value="SERVICE">A service message (about an active contract)</option>
              <option value="MARKETING">Marketing (needs their consent)</option>
            </select>
            <Button onClick={email} disabled={pending || !emailPurpose || !subject.trim() || !body.trim()}>
              Send and log
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
