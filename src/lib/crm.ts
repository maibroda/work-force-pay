/**
 * Pure rules for the bureau's sales pipeline: which moves between stages are allowed, what a referral partner has earned, and the figures on
 * the sales dashboard. No database here.
 *
 * The figures are what the log says happened (contacts made, meetings, proposals, wins), not forecasts. "MRR" here is the monthly fee the
 * bureau expected when a lead was won; the true monthly recurring revenue comes from billing once clients are invoiced.
 */
import { isWorkingDay } from "./payroll-reminders";

export const STAGES = ["QUALIFIED", "DISCOVERY", "PROPOSAL", "PILOT", "WON", "LOST"] as const;
export type Stage = (typeof STAGES)[number];
export const OPEN_STAGES: readonly Stage[] = ["QUALIFIED", "DISCOVERY", "PROPOSAL", "PILOT"];
export const STAGE_LABELS: Record<Stage, string> = { QUALIFIED: "Qualified", DISCOVERY: "Discovery", PROPOSAL: "Proposal", PILOT: "Pilot", WON: "Won", LOST: "Lost" };

export const SEGMENTS = ["SECURITY_FACILITIES", "SME", "OTHER"] as const;
export const SEGMENT_LABELS: Record<(typeof SEGMENTS)[number], string> = { SECURITY_FACILITIES: "Security and facilities", SME: "SME (10 to 100 staff)", OTHER: "Other" };
export const SOURCES = ["OUTBOUND", "INBOUND", "REFERRAL", "EVENT", "OTHER"] as const;
export const SOURCE_LABELS: Record<(typeof SOURCES)[number], string> = { OUTBOUND: "Outbound outreach", INBOUND: "Inbound enquiry", REFERRAL: "Referral partner", EVENT: "Event", OTHER: "Other" };
export const PARTNER_KINDS = ["ACCOUNTANT", "HR_CONSULTANT", "OTHER"] as const;
export const PARTNER_KIND_LABELS: Record<(typeof PARTNER_KINDS)[number], string> = { ACCOUNTANT: "Accountant", HR_CONSULTANT: "HR consultant", OTHER: "Other" };
export const CHANNELS = ["CALL", "EMAIL", "WHATSAPP", "LINKEDIN", "MEETING", "OTHER"] as const;
export const CHANNEL_LABELS: Record<(typeof CHANNELS)[number], string> = { CALL: "Call", EMAIL: "Email", WHATSAPP: "WhatsApp", LINKEDIN: "LinkedIn", MEETING: "Meeting", OTHER: "Other" };
export const OUTCOMES = ["NO_ANSWER", "CONNECTED", "MEETING_BOOKED", "QUALIFIED", "NOT_INTERESTED"] as const;
export type Outcome = (typeof OUTCOMES)[number];
export const OUTCOME_LABELS: Record<Outcome, string> = { NO_ANSWER: "No answer", CONNECTED: "Spoke to the decision-maker", MEETING_BOOKED: "Meeting booked", QUALIFIED: "Qualified", NOT_INTERESTED: "Not interested" };

/** The target from the plan: qualified contacts per working day. A contact counts when it reached a decision-maker (spoke, booked a meeting, or qualified). */
export const DAILY_CONTACT_TARGET = 10;
export const CONTACT_OUTCOMES: readonly Outcome[] = ["CONNECTED", "MEETING_BOOKED", "QUALIFIED"];
export const isContact = (o: Outcome) => CONTACT_OUTCOMES.includes(o);

const round2 = (n: number) => Math.round(n * 100) / 100;
const idx = (s: Stage) => STAGES.indexOf(s);

// ─────────────────────────────── Moving a lead ───────────────────────────────

/** Returns what is wrong with moving a lead, or null if it may move. Moving back (or reopening a lost lead) needs a note saying why. */
export function validateMove(m: { from: Stage; to: Stage; expectedMrr: number; lostReason?: string | null; note?: string | null }): string | null {
  if (m.from === m.to) return `It is already ${STAGE_LABELS[m.to].toLowerCase()}.`;
  if (m.from === "WON") return "A won lead is final. If the client later leaves, that is handled with the client, not here.";
  const note = (m.note ?? "").trim();
  if (m.to === "LOST") return (m.lostReason ?? "").trim().length >= 5 ? null : "Say why it was lost (at least 5 characters), so the pipeline learns from it.";
  if (m.to === "WON") {
    if (m.from === "LOST") return "Reopen the lead first, then mark it won.";
    return m.expectedMrr > 0 ? null : "Enter the monthly fee before marking it won: commission and the MRR figure depend on it.";
  }
  const backwards = m.from === "LOST" || idx(m.to) < idx(m.from);
  if (backwards && note.length < 5) return m.from === "LOST" ? "Say why you are reopening it (at least 5 characters)." : "Say why it went back a stage (at least 5 characters).";
  return null;
}

// ─────────────────────────────── Referral commission ───────────────────────────────

/** Commission earned on a won lead: the partner's percentage of the monthly fee, for the agreed number of months. */
export function commissionEarned(p: { pct: number; months: number; mrr: number }): number {
  return round2((p.mrr * p.pct) / 100 * p.months);
}

// ─────────────────────────────── The dashboard ───────────────────────────────

export type LeadFacts = { id: string; stage: Stage; expectedMrr: number; createdAt: Date; wonAt: Date | null; lostAt: Date | null };
export type ChangeFacts = { leadId: string; toStage: Stage; at: Date };
export type ActivityFacts = { date: string; outcome: Outcome };

const day = (d: Date) => d.toISOString().slice(0, 10);
const within = (d: Date | string, from: string, to: string) => {
  const s = typeof d === "string" ? d : day(d);
  return s >= from && s <= to;
};

/** Every date from `from` to `to` inclusive, as YYYY-MM-DD. */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

export const workingDaysBetween = (from: string, to: string) => datesBetween(from, to).filter(isWorkingDay).length;

export function salesSummary(input: { leads: readonly LeadFacts[]; changes: readonly ChangeFacts[]; activities: readonly ActivityFacts[]; from: string; to: string }) {
  const { leads, changes, activities, from, to } = input;
  const inRange = activities.filter((a) => within(a.date, from, to));
  const contacts = inRange.filter((a) => isContact(a.outcome)).length;
  const reached = (stage: Stage) => new Set(changes.filter((c) => c.toStage === stage && within(c.at, from, to)).map((c) => c.leadId)).size;
  const won = leads.filter((l) => l.wonAt && within(l.wonAt, from, to));
  const lost = leads.filter((l) => l.lostAt && within(l.lostAt, from, to));
  const days = workingDaysBetween(from, to);
  const perDay = new Map<string, number>();
  for (const a of inRange) if (isContact(a.outcome)) perDay.set(a.date, (perDay.get(a.date) ?? 0) + 1);
  const open = leads.filter((l) => OPEN_STAGES.includes(l.stage));
  return {
    attempts: inRange.length,
    contacts,
    workingDays: days,
    contactsPerWorkingDay: days ? round2(contacts / days) : 0,
    daysOnTarget: datesBetween(from, to).filter((d) => isWorkingDay(d) && (perDay.get(d) ?? 0) >= DAILY_CONTACT_TARGET).length,
    newLeads: leads.filter((l) => within(l.createdAt, from, to)).length,
    discoveryMeetings: reached("DISCOVERY"),
    proposals: reached("PROPOSAL"),
    pilots: reached("PILOT"),
    won: won.length,
    lost: lost.length,
    /** Won as a share of the leads that reached an answer in the period; null until one has. */
    conversion: won.length + lost.length ? round2((won.length / (won.length + lost.length)) * 100) : null,
    mrrWon: round2(won.reduce((a, l) => a + l.expectedMrr, 0)),
    mrrTotal: round2(leads.filter((l) => l.stage === "WON").reduce((a, l) => a + l.expectedMrr, 0)),
    pipelineMrr: round2(open.reduce((a, l) => a + l.expectedMrr, 0)),
    byStage: STAGES.map((s) => {
      const here = leads.filter((l) => l.stage === s);
      return { stage: s, count: here.length, mrr: round2(here.reduce((a, l) => a + l.expectedMrr, 0)) };
    }),
  };
}

/** Preset date ranges ending today: this week (from Monday), this month, the last 30 days. */
export function presetRange(preset: "week" | "month" | "30d", today: string): { from: string; to: string } {
  const t = new Date(`${today}T00:00:00Z`);
  if (preset === "month") return { from: `${today.slice(0, 8)}01`, to: today };
  if (preset === "30d") return { from: new Date(t.getTime() - 29 * 86_400_000).toISOString().slice(0, 10), to: today };
  const back = (t.getUTCDay() + 6) % 7; // Monday = 0
  return { from: new Date(t.getTime() - back * 86_400_000).toISOString().slice(0, 10), to: today };
}
