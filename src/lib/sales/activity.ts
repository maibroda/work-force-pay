/**
 * The rules of the activity layer that need no database: call and WhatsApp links, the site-survey checklist, the order of a timeline, and which Lagos day or week a
 * task falls in. The service (src/server/services/sales/activities.ts) uses these and nothing else to decide.
 */
import { z } from "zod";

// ─────────────────────────────── links ───────────────────────────────

const E164 = /^\+[1-9]\d{7,14}$/;

/** A tel: link, only for a number already stored as E.164 (+234...). */
export function telLink(e164: string | null | undefined): string | null {
  return e164 && E164.test(e164) ? `tel:${e164}` : null;
}

/** A wa.me link with the message prefilled (and editable by the person before it is opened). Only for a number stored as E.164. */
export function waLink(e164: string | null | undefined, text: string): string | null {
  if (!e164 || !E164.test(e164)) return null;
  return `https://wa.me/${e164.slice(1)}${text.trim() ? `?text=${encodeURIComponent(text)}` : ""}`;
}

/** The message a WhatsApp starts with: short, in the sender's name, for the sender to edit. */
export function defaultWhatsAppText(p: { firstName: string | null | undefined; company: string | null | undefined; sender: string }): string {
  const hello = p.firstName?.trim() ? `Hello ${p.firstName.trim()}, this is ${p.sender}` : `Hello, this is ${p.sender}`;
  return p.company?.trim() ? `${hello}, about security services for ${p.company.trim()}.` : `${hello}.`;
}

// ─────────────────────────────── site survey ───────────────────────────────

export const surveySchema = z.object({
  siteType: z.string().trim().min(1, "Say the site type (for example residential estate, office, factory)").max(100),
  entryPoints: z.number().int("The number of entry points must be a whole number").min(0, "The number of entry points cannot be negative").max(1000).optional(),
  existingGuards: z.number().int("The number of existing guards must be a whole number").min(0, "The number of existing guards cannot be negative").max(10000).optional(),
  riskNotes: z.string().trim().max(2000).optional(),
  /** Links to photos kept elsewhere: this app stores no files. */
  photoLinks: z
    .array(z.string().trim().url("Each photo must be a web link").refine((u) => /^https?:\/\//i.test(u), "Each photo must be a web link (http or https)"))
    .max(10, "At most 10 photo links")
    .optional(),
});
export type Survey = z.infer<typeof surveySchema>;

// ─────────────────────────────── the timeline ───────────────────────────────

export const TIMELINE_TYPES = ["CALL", "MEETING", "SITE_SURVEY", "WHATSAPP", "EMAIL", "NOTE", "STAGE", "QUOTE", "HANDOVER", "CONSENT", "CASE"] as const;
export type TimelineType = (typeof TIMELINE_TYPES)[number];
export interface TimelineItem {
  id: string;
  type: TimelineType;
  at: Date;
  title: string;
  detail?: string | null;
  by?: string | null;
  voided?: boolean;
}

/** Newest first; two things at the same moment are put in the same order every time. */
export function mergeTimeline(items: TimelineItem[]): TimelineItem[] {
  return [...items].sort((a, b) => b.at.getTime() - a.at.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

/** Only the given types; none given means all. */
export function filterTimeline(items: TimelineItem[], types: readonly TimelineType[]): TimelineItem[] {
  return types.length ? items.filter((i) => types.includes(i.type)) : items;
}

// ─────────────────────────────── tasks by the Lagos day ───────────────────────────────

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** The start (00:00) of the Lagos day (West Africa Time, UTC+1, no daylight saving) that contains the moment. */
export function watDayStart(when: Date): Date {
  return new Date(Math.floor((when.getTime() + HOUR) / DAY) * DAY - HOUR);
}

/** Open tasks as overdue (its time has passed), today (the rest of the Lagos day), this week (to Sunday night) and later; finished and cancelled ones are left out. */
export function groupTasks<T extends { id: string; dueAt: Date; status: string }>(tasks: T[], now: Date) {
  const dayStart = watDayStart(now);
  const dayEnd = dayStart.getTime() + DAY;
  const dow = new Date(dayStart.getTime() + HOUR).getUTCDay(); // 0 = Sunday, in Lagos
  const weekEnd = dayStart.getTime() + (((8 - dow) % 7) || 7) * DAY; // the coming Monday 00:00
  const byDue = (a: T, b: T) => a.dueAt.getTime() - b.dueAt.getTime() || (a.id < b.id ? -1 : 1);
  const out = { overdue: [] as T[], today: [] as T[], thisWeek: [] as T[], later: [] as T[] };
  for (const t of [...tasks].sort(byDue)) {
    if (t.status !== "OPEN") continue;
    const due = t.dueAt.getTime();
    if (due < now.getTime()) out.overdue.push(t);
    else if (due < dayEnd) out.today.push(t);
    else if (due < weekEnd) out.thisWeek.push(t);
    else out.later.push(t);
  }
  return out;
}
