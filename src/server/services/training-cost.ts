/**
 * Training cost and expenditure (slice 4A, approved by the founder on 2026-11-17: plan docs/plans/hr-phases-4-5-plan.md, section 6, as recommended).
 *
 * A RECORD, not a ledger: HR records what a session cost, in exact money (whole kobo, src/lib/money-exact.ts), and nothing is posted to the accounts, no payment is made and no payable is linked.
 *
 *  - HR (hr.manage) records a cost line (fee, travel, materials, venue, other: never wages, which is pay). Over a threshold the company sets, the line waits for a SECOND person who holds the
 *    approval right and is not the recorder. Only APPROVED lines count. A correction is a new negative line that reverses an old one, once: the history is kept, nothing is edited.
 *  - HR sets an annual budget for the company and, optionally, for a department. Over budget is a warning in the report, never a block.
 *  - The report (anyone with HR view: HR, finance, the auditor, the administrators) gives the total, and breakdowns by programme, month and department. A session's cost is shared equally per
 *    attendee; no breakdown shows a row from fewer than three attendances, and nothing names or numbers a person (src/lib/training-cost.ts).
 *
 * Audit entries carry ids, the kind and the amount, never the description.
 */
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { MoneyError, roundRatio, sumKobo, toKobo, koboToString, asKobo, type Kobo } from "@/lib/money-exact";
import { MIN_ATTENDANCES, allocateEqually, foldSmall, type FoldRow } from "@/lib/training-cost";
import { assertCan, BusinessError, db } from "./_base";
import { logAudit } from "./audit";
import { getHrPolicy } from "./hr-policy";

const KINDS = ["FEE", "TRAVEL", "MATERIALS", "VENUE", "OTHER"] as const;
/** The largest single amount: one billion naira, far above any course, to catch a slipped decimal point. */
const MAX_KOBO = 100_000_000_000;

export const COST_NOTE =
  "Spend counts approved cost lines only. A session's cost is shared equally per attendee. A row from fewer than three attendances is not shown on its own, and no figure here names or numbers a person. This is a record: nothing is posted to the accounts and no payment is made.";

/** An amount in naira from a form or a caller, as whole kobo; a plain message when it is not one. */
function amountKobo(value: unknown): Kobo {
  try {
    return toKobo(value);
  } catch (e) {
    if (e instanceof MoneyError) throw new BusinessError(e.message);
    throw e;
  }
}
const positiveKobo = (value: unknown): Kobo => {
  const k = amountKobo(value);
  if (k <= 0) throw new BusinessError("The amount must be above zero.");
  if (k > MAX_KOBO) throw new BusinessError("The amount can be at most ₦1,000,000,000.");
  return k;
};

const shape = (l: { id: string; sessionId: string; kind: string; amount: unknown; description: string; invoiceReference: string | null; status: string; recordedBy: string; recordedAt: Date; reversesId: string | null; decidedBy: string | null; decisionNote: string | null }) => ({
  id: l.id,
  sessionId: l.sessionId,
  kind: l.kind as (typeof KINDS)[number],
  amount: koboToString(amountKobo(l.amount)),
  description: l.description,
  invoiceReference: l.invoiceReference,
  status: l.status as "PENDING" | "APPROVED" | "REJECTED",
  recordedBy: l.recordedBy,
  recordedAt: l.recordedAt,
  reversesId: l.reversesId,
  decidedBy: l.decidedBy,
  decisionNote: l.decisionNote,
});

async function loadSession(ctx: Ctx, id: string) {
  const s = await db.trainingSession.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!s) throw new BusinessError("Session not found.");
  return s;
}

async function loadLine(ctx: Ctx, id: string) {
  const l = await db.trainingCostLine.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!l) throw new BusinessError("Cost line not found.");
  return l;
}

/** Whether a line of this size waits for a second person under the company's threshold (empty threshold: nothing waits). */
async function needsSecondPerson(ctx: Ctx, kobo: Kobo) {
  const p = await getHrPolicy(ctx.orgId);
  if (p.trainingCostApprovalThreshold === null || p.trainingCostApprovalThreshold === undefined) return false;
  return Math.abs(kobo) >= amountKobo(p.trainingCostApprovalThreshold);
}

// ───────────────────────────── Recording ─────────────────────────────

const lineSchema = z.object({
  kind: z.enum(KINDS),
  amount: z.union([z.string(), z.number()]),
  description: z.string().trim().min(3, "Describe the cost (at least 3 characters).").max(200),
  invoiceReference: z
    .string()
    .trim()
    .max(80)
    .optional()
    .transform((v) => (v ? v : undefined)),
});

/** HR records one cost line against a session. Over the company's threshold it waits for a second person. */
export async function recordCost(ctx: Ctx, sessionId: string, raw: z.input<typeof lineSchema>) {
  assertCan(ctx, "hr.manage");
  const v = lineSchema.parse(raw);
  const session = await loadSession(ctx, sessionId);
  const kobo = positiveKobo(v.amount);
  const status = (await needsSecondPerson(ctx, kobo)) ? "PENDING" : "APPROVED";
  const l = await db.$transaction(async (tx) => {
    const created = await tx.trainingCostLine.create({
      data: { organizationId: ctx.orgId, sessionId: session.id, kind: v.kind, amount: koboToString(kobo), description: v.description, invoiceReference: v.invoiceReference ?? null, status, recordedById: ctx.userId, recordedBy: ctx.name },
    });
    // ids, the kind and the amount: not the description
    await logAudit(ctx, { action: "TRAINING_COST_RECORD", entity: "TrainingSession", entityId: session.id, newValue: { lineId: created.id, kind: v.kind, amount: koboToString(kobo), status } }, tx);
    return created;
  });
  return shape(l);
}

/** A correction: a new NEGATIVE line that reverses an approved line, once. The old line stays. */
export async function reverseCost(ctx: Ctx, lineId: string, reason: string) {
  assertCan(ctx, "hr.manage");
  const why = (reason ?? "").trim();
  if (why.length < 5) throw new BusinessError("Give a reason for the reversal (at least 5 characters).");
  const original = await loadLine(ctx, lineId);
  if (original.reversesId) throw new BusinessError("A reversal can't be reversed: record a new cost line instead.");
  if (original.status !== "APPROVED") throw new BusinessError("Only an approved cost line can be reversed.");
  if (await db.trainingCostLine.findUnique({ where: { reversesId: original.id }, select: { id: true } })) throw new BusinessError("This cost line has already been reversed.");
  const kobo = amountKobo(original.amount);
  const status = (await needsSecondPerson(ctx, kobo)) ? "PENDING" : "APPROVED";
  const l = await db.$transaction(async (tx) => {
    const created = await tx.trainingCostLine.create({
      data: { organizationId: ctx.orgId, sessionId: original.sessionId, kind: original.kind, amount: koboToString(asKobo(-kobo)), description: `Reversal: ${why}`.slice(0, 200), reversesId: original.id, status, recordedById: ctx.userId, recordedBy: ctx.name },
    });
    await logAudit(ctx, { action: "TRAINING_COST_REVERSE", entity: "TrainingSession", entityId: original.sessionId, newValue: { lineId: created.id, reverses: original.id, amount: koboToString(asKobo(-kobo)), status } }, tx);
    return created;
  });
  return shape(l);
}

/** The second person approves or declines a line that waited: someone who holds the approval right and did not record it. A decline needs a reason. */
export async function decideCost(ctx: Ctx, lineId: string, decision: "APPROVED" | "REJECTED", note?: string) {
  assertCan(ctx, "hr.approve");
  const l = await loadLine(ctx, lineId);
  if (l.status !== "PENDING") throw new BusinessError(`This cost line has already been ${l.status.toLowerCase()}.`);
  if (l.recordedById === ctx.userId) throw new BusinessError("You recorded this cost line, so someone else must decide it.");
  const why = (note ?? "").trim();
  if (decision === "REJECTED" && why.length < 5) throw new BusinessError("Give a reason for declining (at least 5 characters).");
  await db.$transaction(async (tx) => {
    await tx.trainingCostLine.update({ where: { id: l.id }, data: { status: decision, decidedById: ctx.userId, decidedBy: ctx.name, decidedAt: new Date(), decisionNote: why || null } });
    await logAudit(ctx, { action: "TRAINING_COST_DECIDE", entity: "TrainingSession", entityId: l.sessionId, newValue: { lineId: l.id, status: decision } }, tx);
  });
}

/** Every cost line of one session, with who recorded it. HR alone: finance and the auditor read the totals, not the lines. */
export async function sessionCosts(ctx: Ctx, sessionId: string) {
  assertCan(ctx, "hr.manage");
  const s = await loadSession(ctx, sessionId);
  const rows = await db.trainingCostLine.findMany({ where: { organizationId: ctx.orgId, sessionId: s.id }, orderBy: [{ recordedAt: "asc" }, { id: "asc" }] });
  const total = (status: string) => koboToString(sumKobo(rows.filter((r) => r.status === status).map((r) => amountKobo(r.amount))));
  return { lines: rows.map(shape), approvedTotal: total("APPROVED"), pendingTotal: total("PENDING") };
}

// ───────────────────────────── The budget ─────────────────────────────

/** HR sets the year's budget for the company (department empty) or for one department, replacing an earlier one; an empty amount removes it. */
export async function setTrainingBudget(ctx: Ctx, year: number, departmentId: string | null, amount: string | number | null) {
  assertCan(ctx, "hr.manage");
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new BusinessError("Choose a year between 2000 and 2100.");
  if (departmentId && !(await db.department.findFirst({ where: { id: departmentId, organizationId: ctx.orgId }, select: { id: true } }))) throw new BusinessError("Department not found.");
  const existing = await db.trainingBudget.findFirst({ where: { organizationId: ctx.orgId, year, departmentId: departmentId ?? null } });
  if (amount === null || amount === "") {
    if (existing) await db.trainingBudget.delete({ where: { id: existing.id } });
    await logAudit(ctx, { action: "TRAINING_BUDGET_SET", entity: "TrainingBudget", entityId: existing?.id ?? null, newValue: { year, departmentId, amount: null } });
    return;
  }
  const kobo = positiveKobo(amount);
  const saved = existing
    ? await db.trainingBudget.update({ where: { id: existing.id }, data: { amount: koboToString(kobo), setBy: ctx.name } })
    : await db.trainingBudget.create({ data: { organizationId: ctx.orgId, year, departmentId: departmentId ?? null, amount: koboToString(kobo), setBy: ctx.name } });
  await logAudit(ctx, { action: "TRAINING_BUDGET_SET", entity: "TrainingBudget", entityId: saved.id, newValue: { year, departmentId, amount: koboToString(kobo) } });
}

// ───────────────────────────── The report ─────────────────────────────

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const NO_DEPARTMENT = "none";
const UNALLOCATED = "unallocated";

type Other = { total: string | null; attendances: number; rows: number; shown: boolean } | null;
const other = (o: ReturnType<typeof foldSmall>["other"]): Other => (o ? { total: o.amount === null ? null : koboToString(o.amount), attendances: o.attendances, rows: o.rows, shown: o.shown } : null);

/**
 * The year's spend (sessions dated in that year, approved lines only) and its breakdowns. Anyone with HR view may read it; no row from fewer than three attendances is shown on its own and nothing
 * names or numbers a person.
 */
export async function trainingSpend(ctx: Ctx, year: number) {
  assertCan(ctx, "hr.view");
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new BusinessError("Choose a year between 2000 and 2100.");
  const sessions = await db.trainingSession.findMany({
    where: { organizationId: ctx.orgId, sessionDate: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) } },
    select: {
      id: true,
      sessionDate: true,
      programme: { select: { id: true, name: true } },
      costLines: { select: { amount: true, status: true } },
      enrolments: { where: { status: "ATTENDED" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { employee: { select: { departmentId: true } } } },
    },
  });
  const departments = await db.department.findMany({ where: { organizationId: ctx.orgId }, select: { id: true, name: true } });
  const deptName = new Map(departments.map((d) => [d.id, d.name]));
  const budgets = await db.trainingBudget.findMany({ where: { organizationId: ctx.orgId, year } });

  const byProgramme = new Map<string, { name: string; amount: Kobo[]; attendances: number; sessions: number }>();
  const byMonth = new Map<number, { amount: Kobo[]; attendances: number }>();
  const byDept = new Map<string, { amount: Kobo[]; attendances: number }>();
  const nets: Kobo[] = [];
  const pending: Kobo[] = [];
  const bump = <K,>(m: Map<K, { amount: Kobo[]; attendances: number }>, key: K, amount: Kobo, attendances: number) => {
    const row = m.get(key) ?? { amount: [], attendances: 0 };
    row.amount.push(amount);
    row.attendances += attendances;
    m.set(key, row);
  };
  for (const s of sessions) {
    const net = sumKobo(s.costLines.filter((l) => l.status === "APPROVED").map((l) => amountKobo(l.amount)));
    pending.push(...s.costLines.filter((l) => l.status === "PENDING").map((l) => amountKobo(l.amount)));
    const n = s.enrolments.length;
    nets.push(net);
    const p = byProgramme.get(s.programme.id) ?? { name: s.programme.name, amount: [], attendances: 0, sessions: 0 };
    p.amount.push(net);
    p.attendances += n;
    p.sessions += 1;
    byProgramme.set(s.programme.id, p);
    bump(byMonth, s.sessionDate.getUTCMonth() + 1, net, n);
    // equal share per attendee, to the exact kobo, then by the attendee's department; a session nobody attended is unallocated
    const shares = allocateEqually(net, n);
    if (!shares) bump(byDept, UNALLOCATED, net, 0);
    else s.enrolments.forEach((e, i) => bump(byDept, e.employee.departmentId ?? NO_DEPARTMENT, shares[i], 1));
  }
  const total = sumKobo(nets);
  const sum = (xs: Kobo[]) => sumKobo(xs);

  const progRows = [...byProgramme.entries()].map(([key, v]) => ({ key, label: v.name, amount: sum(v.amount), attendances: v.attendances, sessions: v.sessions }));
  const monthRows = [...byMonth.entries()].sort((a, b) => a[0] - b[0]).map(([m, v]) => ({ key: String(m), label: MONTHS[m - 1], amount: sum(v.amount), attendances: v.attendances }));
  const deptRows = [...byDept.entries()].map(([key, v]) => ({ key, label: key === NO_DEPARTMENT ? "No department" : key === UNALLOCATED ? "Sessions nobody attended" : (deptName.get(key) ?? "Removed department"), amount: sum(v.amount), attendances: v.attendances }));

  const budgetKobo = (departmentId: string | null) => {
    const b = budgets.find((x) => (x.departmentId ?? null) === departmentId);
    return b ? amountKobo(b.amount) : null;
  };
  const companyBudget = budgetKobo(null);
  const fp = foldSmall<FoldRow & { sessions: number }>(progRows);
  const fm = foldSmall(monthRows);
  const fd = foldSmall(deptRows);
  return {
    year,
    total: koboToString(total),
    pendingTotal: koboToString(sum(pending)),
    budget: {
      company: companyBudget === null ? null : koboToString(companyBudget),
      remaining: companyBudget === null ? null : koboToString(asKobo(companyBudget - total)),
      over: companyBudget !== null && total > companyBudget,
    },
    byProgramme: {
      shown: fp.shown.map((r) => ({ programmeId: r.key, name: r.label, total: koboToString(r.amount), sessions: r.sessions, attendances: r.attendances, perAttendee: r.attendances >= MIN_ATTENDANCES ? koboToString(roundRatio(BigInt(r.amount), BigInt(r.attendances))) : null })),
      other: other(fp.other),
    },
    byMonth: { shown: fm.shown.map((r) => ({ month: Number(r.key), name: r.label, total: koboToString(r.amount), attendances: r.attendances })), other: other(fm.other) },
    byDepartment: {
      shown: fd.shown.map((r) => {
        const b = r.key === NO_DEPARTMENT || r.key === UNALLOCATED ? null : budgetKobo(r.key);
        return { departmentId: r.key === NO_DEPARTMENT || r.key === UNALLOCATED ? null : r.key, name: r.label, total: koboToString(r.amount), attendances: r.attendances, budget: b === null ? null : koboToString(b), over: b !== null && r.amount > b };
      }),
      other: other(fd.other),
    },
    note: COST_NOTE,
  };
}
