/**
 * Pure rules for payroll reminder emails. No database here.
 *
 * Two kinds go out. To the client's contact: the inputs still owed as the cut-off nears or passes, and the draft awaiting their approval as that
 * deadline nears or passes. To the bureau team working on the client: a digest of everything overdue or due soon. Nothing is sent at weekends, and
 * the same reminder is never sent twice in a day or more than a handful of times for the same month (the caller enforces both from the log).
 */
import { INPUT_KIND_LABELS, type InputKind, type MilestoneState } from "./payroll-calendar";

export const MAX_CLIENT_REMINDERS_PER_MONTH = 5;

export type ReminderKind = "CLIENT_INPUTS" | "CLIENT_APPROVAL" | "TEAM_DIGEST";

export type MilestoneFact = { key: string; label: string; due: string; done: boolean; state: MilestoneState; days: number };

export type PeriodFacts = {
  periodName: string;
  clientName: string;
  bureauName: string;
  leadDays: number;
  milestones: MilestoneFact[];
  /** Input kinds still expected (not received, not marked not applicable). */
  outstandingInputs: string[];
};

export type PlannedReminder =
  | { kind: "CLIENT_INPUTS"; due: string; overdue: boolean; outstanding: string[] }
  | { kind: "CLIENT_APPROVAL"; due: string; overdue: boolean }
  | { kind: "TEAM_DIGEST"; rows: MilestoneFact[] };

/** No reminders on a Saturday or Sunday. `today` is YYYY-MM-DD. */
export const isWorkingDay = (today: string) => {
  const d = new Date(`${today}T00:00:00Z`).getUTCDay();
  return d !== 0 && d !== 6;
};

const get = (f: PeriodFacts, key: string) => f.milestones.find((m) => m.key === key);

/** What should be sent for one month, before the once-a-day and cap checks. */
export function planReminders(f: PeriodFacts): PlannedReminder[] {
  const out: PlannedReminder[] = [];
  const cutoff = get(f, "inputCutoff");
  if (cutoff && !cutoff.done && f.outstandingInputs.length && cutoff.days <= f.leadDays) {
    out.push({ kind: "CLIENT_INPUTS", due: cutoff.due, overdue: cutoff.days < 0, outstanding: f.outstandingInputs });
  }
  const draft = get(f, "draftDue");
  const approval = get(f, "approvalDue");
  // the client is only waiting on themselves once the draft exists
  if (draft?.done && approval && !approval.done && approval.days <= f.leadDays) {
    out.push({ kind: "CLIENT_APPROVAL", due: approval.due, overdue: approval.days < 0 });
  }
  const rows = f.milestones.filter((m) => !m.done && (m.state === "OVERDUE" || m.state === "DUE_SOON"));
  if (rows.length) out.push({ kind: "TEAM_DIGEST", rows });
  return out;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const when = (due: string, days: number) => (days < 0 ? `${-days} day(s) ago, on ${due}` : days === 0 ? `today, ${due}` : `on ${due}`);
const daysBetween = (due: string, today: string) => Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
const label = (k: string) => INPUT_KIND_LABELS[k as InputKind] ?? k;

export type Mail = { subject: string; text: string; html: string };

/** To the client's contact: the inputs still needed for the month. */
export function renderClientInputs(f: PeriodFacts, p: Extract<PlannedReminder, { kind: "CLIENT_INPUTS" }>, today: string, contact?: string | null): Mail {
  const days = daysBetween(p.due, today);
  const subject = p.overdue ? `Payroll inputs for ${f.periodName} are overdue` : `Payroll inputs for ${f.periodName} are due ${days === 0 ? "today" : `on ${p.due}`}`;
  const items = p.outstanding.map(label);
  const text = [
    `${contact ? `Dear ${contact},` : "Hello,"}`,
    "",
    `We are preparing ${f.clientName}'s payroll for ${f.periodName}. The deadline for your inputs is ${when(p.due, days)}, and we are still waiting for:`,
    ...items.map((i) => `  • ${i}`),
    "",
    "If something does not apply this month, please tell us so we can record it. If you have already sent any of these, please let us know and we will check.",
    "",
    `${f.bureauName}`,
  ].join("\n");
  const html = `<div style="font-family:system-ui,sans-serif;max-width:600px"><p>${contact ? `Dear ${esc(contact)},` : "Hello,"}</p><p>We are preparing ${esc(f.clientName)}'s payroll for ${esc(f.periodName)}. The deadline for your inputs is <b>${esc(when(p.due, days))}</b>, and we are still waiting for:</p><ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul><p>If something does not apply this month, please tell us so we can record it. If you have already sent any of these, please let us know and we will check.</p><p>${esc(f.bureauName)}</p></div>`;
  return { subject, text, html };
}

/** To the client's contact: the draft is waiting for their approval. */
export function renderClientApproval(f: PeriodFacts, p: Extract<PlannedReminder, { kind: "CLIENT_APPROVAL" }>, today: string, contact?: string | null): Mail {
  const days = daysBetween(p.due, today);
  const subject = p.overdue ? `Payroll approval for ${f.periodName} is overdue` : `Payroll for ${f.periodName} is waiting for your approval`;
  const text = [
    `${contact ? `Dear ${contact},` : "Hello,"}`,
    "",
    `The draft payroll for ${f.clientName} for ${f.periodName} is ready and is waiting for your approval. The approval deadline is ${when(p.due, days)}; approving late can delay the pay date.`,
    "",
    "Please review the draft we sent and reply with your approval, or tell us what needs to change.",
    "",
    `${f.bureauName}`,
  ].join("\n");
  const html = `<div style="font-family:system-ui,sans-serif;max-width:600px"><p>${contact ? `Dear ${esc(contact)},` : "Hello,"}</p><p>The draft payroll for ${esc(f.clientName)} for ${esc(f.periodName)} is ready and is waiting for your approval. The approval deadline is <b>${esc(when(p.due, days))}</b>; approving late can delay the pay date.</p><p>Please review the draft we sent and reply with your approval, or tell us what needs to change.</p><p>${esc(f.bureauName)}</p></div>`;
  return { subject, text, html };
}

/** To the team: what is overdue or due soon for this client and month. */
export function renderTeamDigest(f: PeriodFacts, p: Extract<PlannedReminder, { kind: "TEAM_DIGEST" }>, appUrl: string, periodId: string): Mail {
  const overdue = p.rows.filter((r) => r.state === "OVERDUE").length;
  const subject = `${f.clientName} ${f.periodName}: ${overdue ? `${overdue} overdue, ` : ""}${p.rows.length - overdue} due soon`;
  const link = `${appUrl.replace(/\/$/, "")}/payroll/calendar/${periodId}`;
  const text = [
    `${f.clientName} — ${f.periodName}`,
    "",
    ...p.rows.map((r) => `  • ${r.label}: ${r.state === "OVERDUE" ? `${-r.days} day(s) late (${r.due})` : r.days === 0 ? `today (${r.due})` : `in ${r.days} day(s) (${r.due})`}`),
    ...(f.outstandingInputs.length ? ["", `Inputs still expected: ${f.outstandingInputs.map(label).join(", ")}`] : []),
    "",
    `Open the month (work in ${f.clientName} first): ${link}`,
  ].join("\n");
  const html = `<div style="font-family:system-ui,sans-serif;max-width:600px"><h3 style="margin:0 0 8px">${esc(f.clientName)} — ${esc(f.periodName)}</h3><ul>${p.rows
    .map((r) => `<li${r.state === "OVERDUE" ? ' style="color:#b91c1c"' : ""}>${esc(r.label)}: ${esc(r.state === "OVERDUE" ? `${-r.days} day(s) late (${r.due})` : r.days === 0 ? `today (${r.due})` : `in ${r.days} day(s) (${r.due})`)}</li>`)
    .join("")}</ul>${f.outstandingInputs.length ? `<p>Inputs still expected: ${esc(f.outstandingInputs.map(label).join(", "))}</p>` : ""}<p><a href="${esc(link)}">Open the month</a> (work in ${esc(f.clientName)} first)</p></div>`;
  return { subject, text, html };
}
