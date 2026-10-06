/**
 * Personal-data breach register.
 *
 * Every breach is recorded, whether or not anyone outside has to be told. HR logs what happened and when the
 * company became aware (that is when the regulator's clock starts), someone with approval rights assesses the
 * risk to the people affected, and — when there is a risk — records when the regulator (and, for high risk, the
 * people affected) were told. A breach can only be closed once it has been assessed, contained and explained, and
 * every step is kept in an append-only timeline.
 */
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { d } from "@/lib/dates";
import { hoursLeft, needsIndividuals, needsRegulator, notificationSummary, notifyDeadline, notifyState, type Assessment } from "@/lib/breaches";
import { assertCan, BusinessError, db, type Tx } from "./_base";
import { logAudit } from "./audit";
import { getHrPolicy } from "./hr-policy";
import { nextNumber } from "./numbering";

const opt = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));

const text = (label: string, min = 10) => z.string().trim().min(min, `${label} — a sentence is enough`);

async function timeline(tx: Tx, orgId: string, breachId: string, author: string, note: string) {
  await tx.dataBreachUpdate.create({ data: { organizationId: orgId, breachId, author, note } });
}

export const breachSchema = z.object({
  title: z.string().trim().min(4, "Give the breach a short title"),
  description: text("Say what happened"),
  discoveredAt: z.string().min(10, "When did the company become aware?"),
  occurredOn: opt,
  dataCategories: z.array(z.string()).max(20).default([]),
  individualsAffected: z.coerce.number().int().min(0).max(10_000_000).optional(),
});

/** Parses "2026-10-06" or "2026-10-06T14:30" as UTC. */
function when(s: string, label: string): Date {
  const v = new Date(s.length === 10 ? `${s}T00:00:00Z` : s.endsWith("Z") ? s : `${s}Z`);
  if (Number.isNaN(v.getTime())) throw new BusinessError(`${label} isn't a valid date and time.`);
  return v;
}

export async function reportBreach(ctx: Ctx, raw: z.input<typeof breachSchema>) {
  assertCan(ctx, "hr.manage");
  const v = breachSchema.parse(raw);
  const discovered = when(v.discoveredAt, "The discovery time");
  if (discovered > new Date()) throw new BusinessError("The company can't have become aware of a breach in the future.");
  const occurred = v.occurredOn ? d(v.occurredOn) : null;
  if (occurred && Number.isNaN(occurred.getTime())) throw new BusinessError("The date it happened isn't valid.");
  if (occurred && occurred.getTime() > discovered.getTime()) throw new BusinessError("A breach can't have happened after it was discovered.");
  return db.$transaction(async (tx) => {
    const b = await tx.dataBreach.create({
      data: {
        organizationId: ctx.orgId,
        incidentNumber: await nextNumber(tx, ctx.orgId, "DATA_BREACH"),
        title: v.title,
        description: v.description,
        discoveredAt: discovered,
        occurredOn: occurred,
        dataCategories: v.dataCategories,
        individualsAffected: v.individualsAffected ?? null,
        reportedBy: ctx.name,
      },
    });
    await timeline(tx, ctx.orgId, b.id, ctx.name, "Breach logged.");
    await logAudit(ctx, { action: "BREACH_REPORT", entity: "DataBreach", entityId: b.id, newValue: { incidentNumber: b.incidentNumber, discoveredAt: b.discoveredAt.toISOString() } }, tx);
    return b;
  });
}

async function loadOpen(ctx: Ctx, id: string, perm: "hr.manage" | "hr.approve") {
  assertCan(ctx, perm);
  const b = await db.dataBreach.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!b) throw new BusinessError("Breach not found.");
  if (b.status === "CLOSED") throw new BusinessError("This breach is closed.");
  return b;
}

/** Fix details learned since it was logged: how many people, what data, containment and cause. */
export const detailsSchema = z.object({
  dataCategories: z.array(z.string()).max(20).optional(),
  individualsAffected: z.coerce.number().int().min(0).max(10_000_000).optional(),
  containedAt: opt,
  containmentNote: opt,
  rootCause: opt,
  remediation: opt,
});

export async function updateDetails(ctx: Ctx, id: string, raw: z.input<typeof detailsSchema>) {
  const b = await loadOpen(ctx, id, "hr.manage");
  const v = detailsSchema.parse(raw);
  const data: Record<string, unknown> = {};
  const said: string[] = [];
  if (v.dataCategories) {
    data.dataCategories = v.dataCategories;
    said.push(`data involved: ${v.dataCategories.join(", ") || "none listed"}`);
  }
  if (v.individualsAffected !== undefined) {
    data.individualsAffected = v.individualsAffected;
    said.push(`people affected: ${v.individualsAffected}`);
  }
  if (v.containmentNote) {
    if (v.containmentNote.length < 10) throw new BusinessError("Describe how it was contained — a sentence is enough.");
    data.containmentNote = v.containmentNote;
    data.containedAt = v.containedAt ? when(v.containedAt, "The containment time") : (b.containedAt ?? new Date());
    if ((data.containedAt as Date) < b.discoveredAt) throw new BusinessError("It can't have been contained before it was discovered.");
    said.push(`contained: ${v.containmentNote}`);
  }
  if (v.rootCause) {
    data.rootCause = v.rootCause;
    said.push(`cause: ${v.rootCause}`);
  }
  if (v.remediation) {
    data.remediation = v.remediation;
    said.push(`fix: ${v.remediation}`);
  }
  if (!said.length) throw new BusinessError("Nothing to save.");
  return db.$transaction(async (tx) => {
    const u = await tx.dataBreach.update({ where: { id }, data });
    await timeline(tx, ctx.orgId, id, ctx.name, `Details updated — ${said.join("; ")}`);
    await logAudit(ctx, { action: "BREACH_UPDATE", entity: "DataBreach", entityId: id, newValue: data }, tx);
    return u;
  });
}

export async function addNote(ctx: Ctx, id: string, note: string) {
  await loadOpen(ctx, id, "hr.manage");
  if (!note || note.trim().length < 3) throw new BusinessError("Write the note first.");
  await timeline(db, ctx.orgId, id, ctx.name, note.trim());
}

/** The decision that settles whether the regulator and the people affected must be told. */
export async function assessBreach(ctx: Ctx, id: string, assessment: Assessment, note: string) {
  const b = await loadOpen(ctx, id, "hr.approve");
  if (assessment === "UNASSESSED") throw new BusinessError("Choose an assessment.");
  if (!note || note.trim().length < 15) throw new BusinessError("Explain the assessment — including, when you conclude there's no risk, why. Regulators ask.");
  if (b.ndpcNotifiedAt && assessment === "NO_RISK") throw new BusinessError("The regulator has already been told about this breach, so it can't now be assessed as no risk.");
  return db.$transaction(async (tx) => {
    const u = await tx.dataBreach.update({ where: { id }, data: { assessment, assessmentNote: note.trim(), assessedBy: ctx.name, assessedAt: new Date() } });
    await timeline(tx, ctx.orgId, id, ctx.name, `Assessed as "${assessment.replace(/_/g, " ").toLowerCase()}": ${note.trim()}`);
    await logAudit(ctx, { action: "BREACH_ASSESS", entity: "DataBreach", entityId: id, oldValue: { assessment: b.assessment }, newValue: { assessment }, reason: note }, tx);
    return u;
  });
}

/** Record that the regulator has been told. After the deadline, the reason for the delay is required. */
export async function recordRegulatorNotified(ctx: Ctx, id: string, input: { notifiedAt: string; reference?: string; lateReason?: string }) {
  const b = await loadOpen(ctx, id, "hr.approve");
  if (b.assessment === "UNASSESSED") throw new BusinessError("Assess the breach first.");
  if (!needsRegulator(b.assessment)) throw new BusinessError("This breach was assessed as unlikely to harm anyone, so the regulator doesn't need to be told. Change the assessment first if that's wrong.");
  if (b.ndpcNotifiedAt) throw new BusinessError("The regulator has already been told.");
  const at = when(input.notifiedAt, "The notification time");
  if (at > new Date()) throw new BusinessError("The notification can't be in the future.");
  if (at < b.discoveredAt) throw new BusinessError("The regulator can't have been told before the company knew.");
  const policy = await getHrPolicy(ctx.orgId);
  const late = at > notifyDeadline(b.discoveredAt, policy.breachNotifyHours);
  if (late && (!input.lateReason || input.lateReason.trim().length < 10)) throw new BusinessError(`That is after the ${policy.breachNotifyHours}-hour deadline. Give the reason for the delay — the regulator requires it.`);
  return db.$transaction(async (tx) => {
    const u = await tx.dataBreach.update({ where: { id }, data: { ndpcNotifiedAt: at, ndpcReference: input.reference?.trim() || null, lateReason: late ? input.lateReason!.trim() : null } });
    await timeline(tx, ctx.orgId, id, ctx.name, `Regulator notified${input.reference?.trim() ? ` (ref ${input.reference.trim()})` : ""}${late ? ` — late: ${input.lateReason!.trim()}` : ""}.`);
    await logAudit(ctx, { action: "BREACH_NOTIFY_REGULATOR", entity: "DataBreach", entityId: id, newValue: { notifiedAt: at.toISOString(), late }, reason: late ? input.lateReason : undefined }, tx);
    return u;
  });
}

export async function recordIndividualsNotified(ctx: Ctx, id: string, input: { notifiedAt: string; note: string }) {
  const b = await loadOpen(ctx, id, "hr.approve");
  if (!needsIndividuals(b.assessment)) throw new BusinessError("People affected only have to be told when the breach is assessed as high risk.");
  if (b.individualsNotifiedAt) throw new BusinessError("They have already been told.");
  if (!input.note || input.note.trim().length < 10) throw new BusinessError("Say how they were told (letter, SMS, email) and what they were told.");
  const at = when(input.notifiedAt, "The notification time");
  if (at > new Date()) throw new BusinessError("The notification can't be in the future.");
  if (at < b.discoveredAt) throw new BusinessError("They can't have been told before the company knew.");
  return db.$transaction(async (tx) => {
    const u = await tx.dataBreach.update({ where: { id }, data: { individualsNotifiedAt: at, individualsNote: input.note.trim() } });
    await timeline(tx, ctx.orgId, id, ctx.name, `People affected notified: ${input.note.trim()}`);
    await logAudit(ctx, { action: "BREACH_NOTIFY_INDIVIDUALS", entity: "DataBreach", entityId: id, newValue: { notifiedAt: at.toISOString() } }, tx);
    return u;
  });
}

/** Close once assessed, contained, explained and — where required — everyone has been told. */
export async function closeBreach(ctx: Ctx, id: string, note?: string) {
  const b = await loadOpen(ctx, id, "hr.approve");
  const missing: string[] = [];
  if (b.assessment === "UNASSESSED") missing.push("assess the risk");
  if (!b.containedAt) missing.push("record how it was contained");
  if (!b.rootCause) missing.push("record the cause");
  if (!b.remediation) missing.push("record what is being done to stop it recurring");
  if (needsRegulator(b.assessment) && b.assessment !== "UNASSESSED" && !b.ndpcNotifiedAt) missing.push("record that the regulator was told");
  if (needsIndividuals(b.assessment) && !b.individualsNotifiedAt) missing.push("record that the people affected were told");
  if (missing.length) throw new BusinessError(`Before closing: ${missing.join("; ")}.`);
  return db.$transaction(async (tx) => {
    const u = await tx.dataBreach.update({ where: { id }, data: { status: "CLOSED", closedAt: new Date(), closedBy: ctx.name } });
    await timeline(tx, ctx.orgId, id, ctx.name, `Closed.${note?.trim() ? ` ${note.trim()}` : ""}`);
    await logAudit(ctx, { action: "BREACH_CLOSE", entity: "DataBreach", entityId: id, reason: note }, tx);
    return u;
  });
}

/** A breach with its derived deadline state — never stored, always worked out from the facts. */
function withState<T extends { assessment: Assessment; discoveredAt: Date; ndpcNotifiedAt: Date | null }>(b: T, hours: number, now: Date) {
  return {
    ...b,
    deadline: notifyDeadline(b.discoveredAt, hours),
    hoursLeft: hoursLeft(b.discoveredAt, hours, now),
    state: notifyState({ assessment: b.assessment, discoveredAt: b.discoveredAt, notifiedAt: b.ndpcNotifiedAt, hours, now }),
  };
}

export async function listBreaches(ctx: Ctx) {
  assertCan(ctx, "hr.view");
  const [rows, policy] = await Promise.all([db.dataBreach.findMany({ where: { organizationId: ctx.orgId }, orderBy: [{ status: "asc" }, { discoveredAt: "desc" }] }), getHrPolicy(ctx.orgId)]);
  const now = new Date();
  return { hours: policy.breachNotifyHours, rows: rows.map((b) => withState(b, policy.breachNotifyHours, now)) };
}

export async function getBreach(ctx: Ctx, id: string) {
  assertCan(ctx, "hr.view");
  const [b, policy, org] = await Promise.all([
    db.dataBreach.findFirst({ where: { id, organizationId: ctx.orgId }, include: { updates: { orderBy: { createdAt: "asc" } } } }),
    getHrPolicy(ctx.orgId),
    db.organization.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { name: true } }),
  ]);
  if (!b) return null;
  const s = withState(b, policy.breachNotifyHours, new Date());
  return {
    ...s,
    hours: policy.breachNotifyHours,
    summary: notificationSummary(
      { incidentNumber: b.incidentNumber, title: b.title, description: b.description, discoveredAt: b.discoveredAt, occurredOn: b.occurredOn, dataCategories: b.dataCategories, individualsAffected: b.individualsAffected, containmentNote: b.containmentNote, remediation: b.remediation, contact: `${ctx.name}, ${ctx.email}`, organization: org.name },
      b.assessment,
      b.assessmentNote,
    ),
  };
}

/** Open breaches whose regulator deadline is running out or past, for the HR digest (runs as the system). */
export async function breachesNeedingAttention(orgId: string, now: Date) {
  const [open, policy] = await Promise.all([db.dataBreach.findMany({ where: { organizationId: orgId, status: "OPEN" }, orderBy: { discoveredAt: "asc" } }), getHrPolicy(orgId)]);
  return open.map((b) => withState(b, policy.breachNotifyHours, now)).filter((b) => b.state === "OVERDUE" || b.state === "DUE_SOON" || b.assessment === "UNASSESSED");
}

