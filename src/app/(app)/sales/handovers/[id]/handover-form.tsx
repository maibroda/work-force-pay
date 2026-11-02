"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveHandoverAction, submitHandoverAction } from "@/app/actions/sales-handover";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { toast } from "@/components/toaster";

export interface FormSite {
  id: string;
  name: string;
  address: string;
  state: string;
  lga: string;
  contactName: string;
  contactRole: string;
  contactPhone: string;
  contactEmail: string;
  noEquipment: boolean;
  equipment: Array<{ item: string; quantity: string }>;
  posts: Array<{ id: string; label: string; summary: string; categoryId: string }>;
}
export interface FormState {
  scope: string;
  clientRequirements: string;
  startDate: string;
  termMonths: string;
  noSpecialSla: boolean;
  serviceLevels: Array<{ obligation: string; measure: string; consequence: string }>;
  sites: FormSite[];
}

/** What Sales enters in a handover: the scope, the client's requirements, each site's details and equipment, the service levels, and each post's employee category. */
export function HandoverForm({ id, initial, categories, canSend, complete }: { id: string; initial: FormState; categories: Array<{ id: string; name: string }>; canSend: boolean; complete: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [f, setF] = useState<FormState>(initial);
  const [dirty, setDirty] = useState(false);
  const edit = (patch: Partial<FormState>) => (setF((x) => ({ ...x, ...patch })), setDirty(true));
  const editSite = (i: number, patch: Partial<FormSite>) => edit({ sites: f.sites.map((s, j) => (j === i ? { ...s, ...patch } : s)) });

  const body = () => ({
    id,
    scope: f.scope,
    clientRequirements: f.clientRequirements,
    startDate: f.startDate,
    termMonths: f.termMonths,
    noSpecialSla: f.noSpecialSla,
    serviceLevels: f.serviceLevels,
    sites: f.sites.map((s) => ({ id: s.id, address: s.address, state: s.state, lga: s.lga, contactName: s.contactName, contactRole: s.contactRole, contactPhone: s.contactPhone, contactEmail: s.contactEmail, noEquipment: s.noEquipment, equipment: s.equipment })),
    posts: f.sites.flatMap((s) => s.posts.map((p) => ({ id: p.id, categoryId: p.categoryId }))),
  });

  const save = () =>
    start(async () => {
      const res = await saveHandoverAction(body());
      toast(res.ok, res.ok ? (res.message ?? "Saved.") : (res.error ?? "Could not save."));
      if (res.ok) {
        setDirty(false);
        router.refresh();
      }
    });
  const send = () =>
    start(async () => {
      const saved = await saveHandoverAction(body());
      if (!saved.ok) return toast(false, saved.error ?? "Could not save.");
      const res = await submitHandoverAction({ id });
      toast(res.ok, res.ok ? (res.message ?? "Sent.") : (res.error ?? "Could not send."));
      if (res.ok) router.refresh();
    });

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1 sm:col-span-2">
          <Label>Scope of service agreed</Label>
          <Textarea rows={3} value={f.scope} onChange={(e) => edit({ scope: e.target.value })} />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label>The client&apos;s requirements</Label>
          <Textarea rows={3} value={f.clientRequirements} onChange={(e) => edit({ clientRequirements: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label>Start date</Label>
          <Input type="date" value={f.startDate} onChange={(e) => edit({ startDate: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label>Contract term (months)</Label>
          <Input type="number" min={1} value={f.termMonths} onChange={(e) => edit({ termMonths: e.target.value })} />
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Special service-level obligations</h3>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.noSpecialSla} onChange={(e) => edit({ noSpecialSla: e.target.checked })} /> There are none
        </label>
        {!f.noSpecialSla && (
          <>
            {f.serviceLevels.map((s, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-3">
                <Input placeholder="Obligation (for example replace an absent guard)" value={s.obligation} onChange={(e) => edit({ serviceLevels: f.serviceLevels.map((x, j) => (j === i ? { ...x, obligation: e.target.value } : x)) })} />
                <Input placeholder="Time or measure (for example within 2 hours)" value={s.measure} onChange={(e) => edit({ serviceLevels: f.serviceLevels.map((x, j) => (j === i ? { ...x, measure: e.target.value } : x)) })} />
                <div className="flex gap-2">
                  <Input placeholder="Consequence if missed" value={s.consequence} onChange={(e) => edit({ serviceLevels: f.serviceLevels.map((x, j) => (j === i ? { ...x, consequence: e.target.value } : x)) })} />
                  <Button variant="outline" onClick={() => edit({ serviceLevels: f.serviceLevels.filter((_, j) => j !== i) })}>Remove</Button>
                </div>
              </div>
            ))}
            <Button variant="outline" onClick={() => edit({ serviceLevels: [...f.serviceLevels, { obligation: "", measure: "", consequence: "" }] })}>Add an obligation</Button>
          </>
        )}
      </div>

      {f.sites.map((s, i) => (
        <div key={s.id} className="space-y-3 rounded-md border p-3">
          <h3 className="text-sm font-semibold">Site: {s.name}</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1 sm:col-span-3">
              <Label>Address</Label>
              <Input value={s.address} onChange={(e) => editSite(i, { address: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>State</Label>
              <Input value={s.state} onChange={(e) => editSite(i, { state: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Local government</Label>
              <Input value={s.lga} onChange={(e) => editSite(i, { lga: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Client&apos;s site contact: name</Label>
              <Input value={s.contactName} onChange={(e) => editSite(i, { contactName: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Role (for example estate manager)</Label>
              <Input value={s.contactRole} onChange={(e) => editSite(i, { contactRole: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Phone</Label>
              <Input value={s.contactPhone} onChange={(e) => editSite(i, { contactPhone: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Email (optional)</Label>
              <Input value={s.contactEmail} onChange={(e) => editSite(i, { contactEmail: e.target.value })} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Equipment for this site</Label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={s.noEquipment} onChange={(e) => editSite(i, { noEquipment: e.target.checked })} /> None is needed
            </label>
            {!s.noEquipment && (
              <>
                {s.equipment.map((e, k) => (
                  <div key={k} className="grid gap-2 sm:grid-cols-[1fr_8rem_auto]">
                    <Input placeholder="Item (radio, torch, patrol vehicle...)" value={e.item} onChange={(ev) => editSite(i, { equipment: s.equipment.map((x, j) => (j === k ? { ...x, item: ev.target.value } : x)) })} />
                    <Input type="number" min={1} placeholder="Quantity" value={e.quantity} onChange={(ev) => editSite(i, { equipment: s.equipment.map((x, j) => (j === k ? { ...x, quantity: ev.target.value } : x)) })} />
                    <Button variant="outline" onClick={() => editSite(i, { equipment: s.equipment.filter((_, j) => j !== k) })}>Remove</Button>
                  </div>
                ))}
                <Button variant="outline" onClick={() => editSite(i, { equipment: [...s.equipment, { item: "", quantity: "1" }] })}>Add equipment</Button>
              </>
            )}
          </div>
          <div className="space-y-2">
            <Label>Employee category of each post (the contract rate is made for it)</Label>
            {s.posts.map((p, k) => (
              <div key={p.id} className="grid items-center gap-2 sm:grid-cols-[1fr_16rem]">
                <div className="text-sm">
                  {p.label}
                  <div className="text-xs text-muted-foreground">{p.summary}</div>
                </div>
                <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={p.categoryId} onChange={(e) => editSite(i, { posts: s.posts.map((x, j) => (j === k ? { ...x, categoryId: e.target.value } : x)) })}>
                  <option value="">— choose —</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={save} disabled={pending || !dirty} variant="outline">
          {pending ? "Working…" : "Save"}
        </Button>
        {canSend && (
          <Button onClick={send} disabled={pending}>
            Save and send to Operations
          </Button>
        )}
        {!complete && !dirty && <span className="text-xs text-muted-foreground">Sending needs every item below under &quot;Still needed&quot; to be done.</span>}
      </div>
    </div>
  );
}
