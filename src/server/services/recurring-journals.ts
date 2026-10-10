/**
 * Recurring journals.
 *
 * A template that generates an ordinary journal draft each period (rent, insurance amortisation, a standing accrual).
 * The template never touches the ledger and carries no approval of its own: every journal it generates goes through
 * submit, approve (by someone other than the preparer) and post exactly like one typed in by hand.
 *
 *  • The preparer of a generated journal is whoever last changed the template, so they can't approve what it generates.
 *  • "Submit automatically" submits each draft for approval at once; it never posts. If the organization has switched
 *    approval off it is ignored (the draft is left for a person), because that would post to the ledger unattended.
 *  • A generated journal that can't be submitted (a closed period, an inactive account) is left as a draft with the
 *    reason on the template, and the run carries on.
 *  • One journal per template per posting date, enforced by the database, so a repeated or concurrent run can't double up.
 *  • A template that has been idle catches up, oldest first, up to MAX_CATCH_UP journals a run.
 *  • The schedule is fixed once the first journal exists; end the template and start another to change it.
 */
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { addDays, d } from "@/lib/dates";
import { cleanDimensions } from "@/lib/dimensions";
import { round2 } from "@/lib/money";
import { MAX_CATCH_UP, nextAfter, occurrence, renderDescription, templateProblems, type Frequency } from "@/lib/recurring";
import { assertCan, BusinessError, db, type Tx } from "./_base";
import { logAudit } from "./audit";
import { approvalRequired, assertNoControlAccounts, submitInTx } from "./journals";
import { nextNumber } from "./numbering";

const KINDS = ["MANUAL", "ADJUSTMENT", "ACCRUAL", "RECLASSIFICATION"] as const;
const FREQUENCIES = ["MONTHLY", "QUARTERLY", "YEARLY"] as const;

const lineSchema = z.object({
  accountId: z.string().default(""),
  description: z.string().trim().max(200).default(""),
  debit: z.coerce.number().min(0).default(0),
  credit: z.coerce.number().min(0).default(0),
  dimensions: z.record(z.string(), z.string().nullable().optional()).optional(),
});

export const templateSchema = z.object({
  name: z.string().trim().min(3, "Give the template a name").max(120),
  kind: z.enum(KINDS).default("MANUAL"),
  description: z.string().trim().min(3, "Say what the journals are for").max(300),
  frequency: z.enum(FREQUENCIES).default("MONTHLY"),
  monthEnd: z.coerce.boolean().default(false),
  startDate: z.string().min(10, "Choose the date of the first journal"),
  endDate: z.string().optional().transform((v) => (v ? v : undefined)),
  reverseAfterDays: z.coerce.number().int().optional(),
  autoSubmit: z.coerce.boolean().default(false),
  lines: z.array(lineSchema).max(200, "That is more lines than one journal should carry"),
});
export type TemplateInput = z.input<typeof templateSchema>;

function parseDate(label: string, v?: string): Date | null {
  if (!v) return null;
  const x = d(v);
  if (Number.isNaN(x.getTime())) throw new BusinessError(`${label} isn't a valid date.`);
  return x;
}

const toDay = (x: Date) => new Date(x.toISOString().slice(0, 10) + "T00:00:00Z");

/** The dimensions on a stored line, as a value to store again (undefined when there are none). */
const storedDims = (stored: unknown) => {
  const clean = cleanDimensions((stored ?? {}) as Record<string, string | null>);
  return Object.keys(clean).length ? clean : undefined;
};

async function load(ctx: Ctx, tx: Tx, id: string) {
  const t = await tx.recurringJournal.findFirst({ where: { id, organizationId: ctx.orgId }, include: { lines: { orderBy: { sortOrder: "asc" } } } });
  if (!t) throw new BusinessError("Recurring journal not found.");
  return t;
}

// ───────────────────────────── Maintaining templates ─────────────────────────────

export async function saveTemplate(ctx: Ctx, id: string | null, raw: TemplateInput) {
  assertCan(ctx, "journal.manage");
  const v = templateSchema.parse(raw);
  const startDate = parseDate("The first date", v.startDate)!;
  const endDate = parseDate("The end date", v.endDate);
  const reverseAfterDays = v.kind === "ACCRUAL" ? (v.reverseAfterDays ?? null) : null;

  const lines = v.lines
    .map((l) => ({ accountId: l.accountId, description: l.description, debit: round2(l.debit), credit: round2(l.credit), dimensions: storedDims(l.dimensions) }))
    .filter((l) => l.accountId || l.debit !== 0 || l.credit !== 0);
  const problems = templateProblems({ name: v.name, kind: v.kind, description: v.description, frequency: v.frequency, monthEnd: v.monthEnd, startDate, endDate, reverseAfterDays, lines });
  if (problems.length) throw new BusinessError(problems.slice(0, 3).join(" "));
  const accountIds = [...new Set(lines.map((l) => l.accountId))];
  if ((await db.glAccount.count({ where: { organizationId: ctx.orgId, id: { in: accountIds } } })) !== accountIds.length) throw new BusinessError("A line names an account that doesn't exist in this organization.");
  const lineData = lines.map((l, i) => ({ ...l, sortOrder: i }));

  return db.$transaction(async (tx) => {
    await assertNoControlAccounts(tx, ctx.orgId, accountIds);
    if (!id) {
      const t = await tx.recurringJournal.create({
        data: {
          organizationId: ctx.orgId,
          name: v.name,
          kind: v.kind,
          description: v.description,
          frequency: v.frequency,
          monthEnd: v.monthEnd,
          startDate,
          endDate,
          nextRunDate: startDate,
          reverseAfterDays,
          autoSubmit: v.autoSubmit,
          createdBy: ctx.name,
          createdByUserId: ctx.userId,
          updatedBy: ctx.name,
          updatedByUserId: ctx.userId,
          lines: { create: lineData },
        },
      });
      await logAudit(ctx, { action: "RECURRING_JOURNAL_CREATE", entity: "RecurringJournal", entityId: t.id, newValue: { name: v.name, frequency: v.frequency, startDate: v.startDate } }, tx);
      return t;
    }
    const existing = await load(ctx, tx, id);
    const scheduleChanged = existing.frequency !== v.frequency || existing.monthEnd !== v.monthEnd || existing.startDate.getTime() !== startDate.getTime();
    if (existing.generatedCount > 0 && scheduleChanged) throw new BusinessError("The schedule can't change once journals have been generated. End this template (pause it and set an end date) and create a new one.");
    // moving the end date moves the next run: it is the nth date from the start, or nothing if that is past the end
    const upcoming = occurrence(startDate, existing.generatedCount, v.frequency, v.monthEnd);
    const nextRunDate = endDate && upcoming > endDate ? null : upcoming;
    await tx.recurringJournalLine.deleteMany({ where: { templateId: id } });
    const t = await tx.recurringJournal.update({
      where: { id },
      data: {
        name: v.name,
        kind: v.kind,
        description: v.description,
        frequency: v.frequency,
        monthEnd: v.monthEnd,
        startDate,
        endDate,
        nextRunDate,
        reverseAfterDays,
        autoSubmit: v.autoSubmit,
        updatedBy: ctx.name,
        updatedByUserId: ctx.userId,
        lines: { create: lineData },
      },
    });
    await logAudit(ctx, { action: "RECURRING_JOURNAL_UPDATE", entity: "RecurringJournal", entityId: id, newValue: { name: v.name, lines: lineData.length } }, tx);
    return t;
  });
}

/** Pauses or resumes a template. Resuming catches up on the dates missed while it was paused. */
export async function setTemplateActive(ctx: Ctx, id: string, active: boolean) {
  assertCan(ctx, "journal.manage");
  return db.$transaction(async (tx) => {
    const t = await load(ctx, tx, id);
    // whoever resumes it takes over as preparer, so it can't be quietly left under someone else's name
    await tx.recurringJournal.update({ where: { id }, data: { active, ...(active ? { updatedBy: ctx.name, updatedByUserId: ctx.userId } : {}) } });
    await logAudit(ctx, { action: active ? "RECURRING_JOURNAL_RESUME" : "RECURRING_JOURNAL_PAUSE", entity: "RecurringJournal", entityId: id, newValue: { name: t.name } }, tx);
  });
}

/** Removes a template that never generated anything. One that has stays on record; pause it instead. */
export async function deleteTemplate(ctx: Ctx, id: string) {
  assertCan(ctx, "journal.manage");
  return db.$transaction(async (tx) => {
    const t = await load(ctx, tx, id);
    if (await tx.journalDocument.count({ where: { recurringJournalId: id } })) throw new BusinessError("This template has generated journals, which stay on record. Pause it instead.");
    await tx.recurringJournal.delete({ where: { id } });
    await logAudit(ctx, { action: "RECURRING_JOURNAL_DELETE", entity: "RecurringJournal", entityId: id, oldValue: { name: t.name } }, tx);
  });
}

// ───────────────────────────── Generating ─────────────────────────────

export interface RunResult {
  templates: number;
  generated: number;
  submitted: number;
  notes: string[];
}

/** Generates every journal that has come due for one template, oldest first. */
async function generateFor(ctx: Ctx, templateId: string, today: Date): Promise<Omit<RunResult, "templates">> {
  const out = { generated: 0, submitted: 0, notes: [] as string[] };
  for (let i = 0; i < MAX_CATCH_UP; i++) {
    const t = await db.recurringJournal.findFirst({ where: { id: templateId, organizationId: ctx.orgId }, include: { lines: { orderBy: { sortOrder: "asc" } } } });
    if (!t || !t.active || !t.nextRunDate || t.nextRunDate > today) break;
    const date = t.nextRunDate;
    const preparer: Ctx = { userId: t.updatedByUserId, orgId: ctx.orgId, role: "FINANCE", name: t.updatedBy, email: "recurring-journals@invalid.local", employeeId: null };

    const doc = await db.$transaction(async (tx) => {
      // claim this date: if another run got here first the count is 0 and nothing is created
      const next = nextAfter(t.startDate, t.generatedCount, t.frequency as Frequency, t.monthEnd, t.endDate);
      const claimed = await tx.recurringJournal.updateMany({ where: { id: t.id, nextRunDate: date, generatedCount: t.generatedCount }, data: { generatedCount: { increment: 1 }, nextRunDate: next, lastRunAt: new Date() } });
      if (!claimed.count) return null;
      const created = await tx.journalDocument.create({
        data: {
          organizationId: ctx.orgId,
          documentNumber: await nextNumber(tx, ctx.orgId, "MANUAL_JOURNAL"),
          kind: t.kind,
          description: renderDescription(t.description, date),
          postingDate: date,
          reverseOn: t.kind === "ACCRUAL" && t.reverseAfterDays ? addDays(date, t.reverseAfterDays) : null,
          createdBy: t.updatedBy,
          createdByUserId: t.updatedByUserId,
          recurringJournalId: t.id,
          lines: { create: t.lines.map((l, n) => ({ accountId: l.accountId, description: l.description, debit: l.debit, credit: l.credit, sortOrder: n, dimensions: storedDims(l.dimensions) })) },
        },
      });
      await logAudit(ctx, { action: "RECURRING_JOURNAL_GENERATE", entity: "JournalDocument", entityId: created.id, newValue: { template: t.name, documentNumber: created.documentNumber, postingDate: date.toISOString().slice(0, 10) } }, tx);
      return created;
    });
    if (!doc) break;
    out.generated++;

    if (t.autoSubmit) {
      try {
        if (!(await approvalRequired(db, ctx.orgId))) throw new BusinessError("approval is switched off for this organization, so a person has to submit it");
        await db.$transaction((tx) => submitInTx(preparer, tx, doc.id));
        out.submitted++;
      } catch (e) {
        out.notes.push(`${t.name}: ${doc.documentNumber} (${date.toISOString().slice(0, 10)}) was left as a draft — ${e instanceof BusinessError ? e.message : "unexpected error; see the server log"}`);
      }
    }
  }
  if (out.notes.length) await db.recurringJournal.updateMany({ where: { id: templateId, organizationId: ctx.orgId }, data: { lastRunNote: out.notes.join(" · ").slice(0, 900) } });
  else if (out.generated) await db.recurringJournal.updateMany({ where: { id: templateId, organizationId: ctx.orgId }, data: { lastRunNote: null } });
  return out;
}

/** Generates what is due across the organization's templates. */
export async function generateDue(ctx: Ctx, today: Date): Promise<RunResult> {
  const day = toDay(today);
  const due = await db.recurringJournal.findMany({ where: { organizationId: ctx.orgId, active: true, nextRunDate: { lte: day } }, select: { id: true }, orderBy: { nextRunDate: "asc" } });
  const total: RunResult = { templates: due.length, generated: 0, submitted: 0, notes: [] };
  for (const t of due) {
    try {
      const r = await generateFor(ctx, t.id, day);
      total.generated += r.generated;
      total.submitted += r.submitted;
      total.notes.push(...r.notes);
    } catch (e) {
      total.notes.push(`A template could not be run: ${e instanceof BusinessError ? e.message : "unexpected error; see the server log"}`);
    }
  }
  return total;
}

/** For a person pressing the button. */
export async function runDueNow(ctx: Ctx, today: Date) {
  assertCan(ctx, "journal.manage");
  return generateDue(ctx, today);
}

/** For the scheduler: every organization, acting as the system. */
export async function generateDueForAllOrgs(today = new Date()) {
  const orgs = await db.organization.findMany({ select: { id: true, name: true } });
  const out: Array<{ organization: string; templates: number; generated: number; submitted: number; held: number }> = [];
  for (const o of orgs) {
    const r = await generateDue({ userId: "system", orgId: o.id, role: "COMPANY_ADMIN", name: "System (recurring journals)", email: "system@invalid.local", employeeId: null }, today);
    out.push({ organization: o.name, templates: r.templates, generated: r.generated, submitted: r.submitted, held: r.notes.length });
  }
  return out;
}

// ───────────────────────────── Reading ─────────────────────────────

export async function listTemplates(ctx: Ctx) {
  assertCan(ctx, "gl.view");
  const rows = await db.recurringJournal.findMany({
    where: { organizationId: ctx.orgId },
    include: { lines: { select: { debit: true } }, _count: { select: { documents: true } } },
    orderBy: [{ active: "desc" }, { nextRunDate: "asc" }, { name: "asc" }],
  });
  return rows.map((r) => ({ ...r, amount: round2(r.lines.reduce((s, l) => s + Number(l.debit), 0)) }));
}

export async function getTemplate(ctx: Ctx, id: string) {
  assertCan(ctx, "gl.view");
  return db.recurringJournal.findFirst({
    where: { id, organizationId: ctx.orgId },
    include: {
      lines: { orderBy: { sortOrder: "asc" }, include: { account: { select: { code: true, name: true } } } },
      documents: { orderBy: { postingDate: "desc" }, take: 60, select: { id: true, documentNumber: true, postingDate: true, status: true, journal: { select: { id: true, entryNumber: true } } } },
    },
  });
}
