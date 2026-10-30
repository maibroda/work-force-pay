/**
 * The handover of an accepted quote to Operations, as plain rules with no database: which sites a quote names, when a contract term ends, what a handover still
 * needs before it can be sent, and what is made on acceptance. The service (src/server/services/sales/handover.ts) uses these and nothing else to decide.
 */
import { z } from "zod";
import { addDays } from "@/lib/dates";
import { addMonths } from "@/lib/leave";

export const equipmentSchema = z.object({
  item: z.string().trim().min(2, "Name the equipment").max(100),
  quantity: z.number().int("The quantity is a whole number").min(1, "The quantity is at least 1").max(100000),
});
export const serviceLevelSchema = z.object({
  obligation: z.string().trim().min(3, "Say what the obligation is").max(300),
  measure: z.string().trim().max(200).optional(),
  consequence: z.string().trim().max(300).optional(),
});
export type Equipment = z.infer<typeof equipmentSchema>;
export type ServiceLevel = z.infer<typeof serviceLevelSchema>;

/** Two spellings of the same site (case, spaces) are one site. */
export const siteKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

/** The quote's lines grouped by site, in the order the sites first appear, keeping the first spelling and the first address given. */
export function groupSites<L extends { siteName: string; siteAddress?: string | null }>(lines: L[]): Array<{ key: string; name: string; address: string | null; lines: L[] }> {
  const out = new Map<string, { key: string; name: string; address: string | null; lines: L[] }>();
  for (const l of lines) {
    const key = siteKey(l.siteName);
    const g = out.get(key);
    if (g) {
      g.lines.push(l);
      if (!g.address && l.siteAddress) g.address = l.siteAddress;
    } else out.set(key, { key, name: l.siteName.trim().replace(/\s+/g, " "), address: l.siteAddress ?? null, lines: [l] });
  }
  return [...out.values()];
}

const isoOf = (dt: Date) => dt.toISOString().slice(0, 10);

/** The last day of a term that starts on `startIso` and runs `months` months: the day before the same date `months` later. */
export function termEnd(startIso: string, months: number): string {
  return isoOf(addDays(addMonths(new Date(`${startIso}T00:00:00Z`), months), -1));
}

export interface PostFacts {
  postLabel: string | null;
  categoryId: string | null;
  structureId: string;
  billPerHead: string;
  operativeSharePct: string;
  businessLine: string;
  headcount: number;
  requiredPersonnel: number;
}
export interface SiteFacts {
  id: string;
  name: string;
  address: string | null;
  state: string | null;
  lga: string | null;
  contactName: string | null;
  contactPhoneE164: string | null;
  equipment: Equipment[];
  noEquipment: boolean;
  posts: PostFacts[];
}
export interface HandoverFacts {
  scope: string | null;
  clientRequirements: string | null;
  startDate: string | null;
  termMonths: number | null;
  noSpecialSla: boolean;
  serviceLevels: ServiceLevel[];
  sites: SiteFacts[];
}

const blank = (s: string | null | undefined) => !s || !s.trim();
/** "70.00" and "70" are the same figure (compared as text, never as arithmetic). */
const same = (a: string, b: string) => a.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "") === b.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
const label = (p: PostFacts, s: SiteFacts) => `Post "${p.postLabel ?? "unnamed post"}" at "${s.name}"`;

/** What a handover still needs before it can be sent to Operations, in plain words. Empty means it is complete. */
export function missingForSubmit(f: HandoverFacts): string[] {
  const m: string[] = [];
  if (blank(f.scope)) m.push("Scope of service");
  if (blank(f.clientRequirements)) m.push("Client requirements");
  if (blank(f.startDate)) m.push("Start date");
  if (!f.termMonths) m.push("Contract term in months");
  if (f.noSpecialSla && f.serviceLevels.length) m.push("Service-level obligations: you listed some and also said there are none");
  else if (!f.noSpecialSla && !f.serviceLevels.length) m.push("Service-level obligations (list them, or say there are none)");
  for (const s of f.sites) {
    const w = `Site "${s.name}"`;
    if (blank(s.address)) m.push(`${w}: address`);
    if (blank(s.state)) m.push(`${w}: state`);
    if (blank(s.lga)) m.push(`${w}: local government`);
    if (blank(s.contactName)) m.push(`${w}: the client's site contact name`);
    if (blank(s.contactPhoneE164)) m.push(`${w}: the client's site contact phone`);
    if (s.noEquipment && s.equipment.length) m.push(`${w}: equipment: you listed some and also said none is needed`);
    else if (!s.noEquipment && !s.equipment.length) m.push(`${w}: equipment (list it, or say none is needed)`);
    for (const p of s.posts) if (!p.categoryId) m.push(`${label(p, s)}: employee category`);
  }
  // a contract has one rate for a category, and is guarding or outsourcing, not both
  const posts = f.sites.flatMap((s) => s.posts.map((p) => ({ p, s })));
  const byCategory = new Map<string, typeof posts>();
  for (const x of posts) if (x.p.categoryId) byCategory.set(x.p.categoryId, [...(byCategory.get(x.p.categoryId) ?? []), x]);
  for (const group of byCategory.values()) {
    const first = group[0].p;
    const clash = group.find((x) => x.p.structureId !== first.structureId || !same(x.p.billPerHead, first.billPerHead) || !same(x.p.operativeSharePct, first.operativeSharePct));
    if (clash) m.push(`${label(first, group[0].s)} and ${label(clash.p, clash.s).toLowerCase()} are in the same employee category but differ in pay structure, bill rate or share: a contract has one rate for a category. Give them different categories, or make them match on the quote.`);
  }
  if (new Set(posts.map((x) => x.p.businessLine)).size > 1) m.push("The quote mixes guarding and outsourcing posts: a contract is one or the other. Quote them separately.");
  return m;
}

/** What acceptance makes, worked out from a complete handover: the contract's business line and default structure, one rate per category, and each site's approved strength. */
export function contractPlan(f: HandoverFacts) {
  const posts = f.sites.flatMap((s) => s.posts);
  const structures = new Set(posts.map((p) => p.structureId));
  const rates: Array<{ categoryId: string; structureId: string; agreedRate: string; operativeSharePct: string }> = [];
  for (const p of posts) {
    if (p.categoryId && !rates.some((r) => r.categoryId === p.categoryId)) rates.push({ categoryId: p.categoryId, structureId: p.structureId, agreedRate: p.billPerHead, operativeSharePct: p.operativeSharePct });
  }
  return {
    businessLine: (posts[0]?.businessLine ?? "GUARDING") as "GUARDING" | "OUTSOURCING",
    structureId: structures.size === 1 ? [...structures][0] : null,
    rates,
    // the people needed to cover the agreed shifts, not the guards billed
    beats: f.sites.map((s) => ({ siteId: s.id, approvedStrength: s.posts.reduce((n, p) => n + p.requiredPersonnel, 0) })),
  };
}
