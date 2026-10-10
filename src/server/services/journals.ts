/**
 * Manual journals and reversals.
 *
 * A manual journal is a document. It is drafted and edited freely, submitted, approved by someone other than whoever
 * prepared it, and then posted through the posting engine; only at that point does anything reach the ledger. After
 * submission its lines can't be changed (the database enforces it) until it is returned.
 *
 *   DRAFT ──submit──▶ SUBMITTED ──approve──▶ APPROVED ──post──▶ POSTED
 *     ▲                   │  └──────reject────────┘ (also from APPROVED)
 *     └──── REJECTED ◀────┘      DRAFT / REJECTED ──cancel──▶ CANCELLED
 *
 * A posted manual journal is never edited or deleted. If it was wrong, a reversal is requested with a reason, someone
 * else approves it, and a mirror journal (same accounts and dimensions, debit and credit swapped) is posted on a date
 * the books accept, linked to the original. An accrual reverses itself automatically on its set date. Journals made
 * by other parts of the system can't be reversed from here; they are corrected through their own document.
 *
 * Whether manual journals need approval at all is an organization setting (on by default). Turning it off lets the
 * person who prepares a journal post it; the setting and every use of it are audited.
 */
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { d } from "@/lib/dates";
import { cleanDimensions } from "@/lib/dimensions";
import { canEditDocument, draftProblems, reversibility, STATUS_LABELS, type DocumentStatus } from "@/lib/journals";
import { round2 } from "@/lib/money";
import { assertCan, BusinessError, db, type Tx } from "./_base";
import { logAudit } from "./audit";
import { nextNumber } from "./numbering";
import { GL_POSTING_ACCOUNTS } from "./gl-posting";
import { mirrorLines, postJournal, validateJournal, type PostingInput } from "./posting";

const said = (status: DocumentStatus) => STATUS_LABELS[status].toLowerCase();

/**
 * Receivables and payables are control accounts: they move only through invoices, receipts, credit notes and payments,
 * so the client and supplier records always agree with them. A manual journal can't post to them.
 */
const CONTROL_ACCOUNTS: Record<string, string> = { [GL_POSTING_ACCOUNTS.AR]: "Receivables", [GL_POSTING_ACCOUNTS.AP]: "Payables" };

async function assertNoControlAccounts(tx: Tx, orgId: string, accountIds: string[]) {
  const hit = await tx.glAccount.findFirst({ where: { organizationId: orgId, id: { in: accountIds }, code: { in: Object.keys(CONTROL_ACCOUNTS) } }, select: { code: true, name: true } });
  if (hit)
    throw new BusinessError(
      `${hit.code} ${hit.name} is the ${CONTROL_ACCOUNTS[hit.code].toLowerCase()} control account. It moves only through ${hit.code === GL_POSTING_ACCOUNTS.AR ? "client invoices, receipts, credit notes and deductions" : "supplier bills, payments and deductions"}, so the ${hit.code === GL_POSTING_ACCOUNTS.AR ? "client" : "supplier"} records always agree with it. A manual journal can't post to it.`,
    );
}

const KINDS = ["MANUAL", "ADJUSTMENT", "ACCRUAL", "RECLASSIFICATION"] as const;

const lineSchema = z.object({
  accountId: z.string().default(""),
  description: z.string().trim().max(200).default(""),
  debit: z.coerce.number().min(0).default(0),
  credit: z.coerce.number().min(0).default(0),
  dimensions: z.record(z.string(), z.string().nullable().optional()).optional(),
});

export const draftSchema = z.object({
  kind: z.enum(KINDS).default("MANUAL"),
  description: z.string().trim().min(3, "Say what the journal is for").max(300),
  postingDate: z.string().min(10, "Choose the date it posts on"),
  reverseOn: z.string().optional().transform((v) => (v ? v : undefined)),
  lines: z.array(lineSchema).max(200, "That is more lines than one journal should carry; split it"),
});
export type DraftInput = z.input<typeof draftSchema>;

function parseDate(label: string, v?: string): Date | null {
  if (!v) return null;
  const x = d(v);
  if (Number.isNaN(x.getTime())) throw new BusinessError(`${label} isn't a valid date.`);
  return x;
}

/** The dimensions on a stored line, as the posting engine takes them. */
const dimsOf = (stored: unknown) => cleanDimensions((stored ?? {}) as Record<string, string | null>);

async function load(ctx: Ctx, tx: Tx, id: string) {
  const doc = await tx.journalDocument.findFirst({ where: { id, organizationId: ctx.orgId }, include: { lines: { orderBy: { sortOrder: "asc" } } } });
  if (!doc) throw new BusinessError("Journal not found.");
  return doc;
}

type Doc = Awaited<ReturnType<typeof load>>;

/** The posting engine's input for a document. */
function postingInput(doc: Doc): PostingInput {
  return {
    source: "MANUAL_JOURNAL",
    sourceType: "MANUAL_JOURNAL",
    sourceId: doc.id,
    postingDate: doc.postingDate,
    description: `${doc.documentNumber} — ${doc.description}`,
    lines: doc.lines.map((l) => ({ accountId: l.accountId, description: l.description || doc.description, debit: Number(l.debit), credit: Number(l.credit), dimensions: dimsOf(l.dimensions) })),
    audit: { documentNumber: doc.documentNumber, kind: doc.kind },
  };
}

// ───────────────────────────── Drafting ─────────────────────────────

/** Creates a draft (id null) or replaces the content of a draft or returned journal. Light checks only; submitting checks everything. */
export async function saveDraft(ctx: Ctx, id: string | null, raw: DraftInput) {
  assertCan(ctx, "journal.manage");
  const v = draftSchema.parse(raw);
  const postingDate = parseDate("The posting date", v.postingDate)!;
  const reverseOn = parseDate("The reversal date", v.reverseOn);
  const accountIds = [...new Set(v.lines.map((l) => l.accountId).filter(Boolean))];
  if (accountIds.length && (await db.glAccount.count({ where: { organizationId: ctx.orgId, id: { in: accountIds } } })) !== accountIds.length)
    throw new BusinessError("A line names an account that doesn't exist in this organization.");

  return db.$transaction(async (tx) => {
    const lineData = v.lines.map((l, i) => ({
      accountId: l.accountId,
      description: l.description,
      debit: round2(l.debit),
      credit: round2(l.credit),
      sortOrder: i,
      dimensions: Object.keys(cleanDimensions(l.dimensions as never)).length ? cleanDimensions(l.dimensions as never) : undefined,
    }));
    // A blank row is just dropped; a row with an amount but no account is refused, so an entry is never lost silently.
    const noAccount = lineData.findIndex((l) => !l.accountId && (l.debit !== 0 || l.credit !== 0));
    if (noAccount >= 0) throw new BusinessError(`Line ${noAccount + 1} has an amount but no account.`);
    const cleanLines = lineData.filter((l) => l.accountId).map((l, i) => ({ ...l, sortOrder: i }));
    if (!id) {
      const doc = await tx.journalDocument.create({
        data: {
          organizationId: ctx.orgId,
          documentNumber: await nextNumber(tx, ctx.orgId, "MANUAL_JOURNAL"),
          kind: v.kind,
          description: v.description,
          postingDate,
          reverseOn,
          createdBy: ctx.name,
          createdByUserId: ctx.userId,
          lines: { create: cleanLines },
        },
      });
      await logAudit(ctx, { action: "JOURNAL_DOC_CREATE", entity: "JournalDocument", entityId: doc.id, newValue: { documentNumber: doc.documentNumber, kind: v.kind, lines: cleanLines.length } }, tx);
      return doc;
    }
    const existing = await load(ctx, tx, id);
    if (!canEditDocument(existing.status as DocumentStatus)) throw new BusinessError("Only a draft or a returned journal can be edited.");
    await tx.journalDocumentLine.deleteMany({ where: { documentId: id } });
    const doc = await tx.journalDocument.update({
      where: { id },
      data: { kind: v.kind, description: v.description, postingDate, reverseOn, status: "DRAFT", lines: { create: cleanLines } },
    });
    await logAudit(ctx, { action: "JOURNAL_DOC_UPDATE", entity: "JournalDocument", entityId: id, newValue: { lines: cleanLines.length } }, tx);
    return doc;
  });
}

export async function cancelDocument(ctx: Ctx, id: string, reason: string) {
  assertCan(ctx, "journal.manage");
  if (!reason || reason.trim().length < 5) throw new BusinessError("Say why it is being cancelled.");
  return db.$transaction(async (tx) => {
    const doc = await load(ctx, tx, id);
    if (!canEditDocument(doc.status as DocumentStatus)) throw new BusinessError("Only a draft or a returned journal can be cancelled. A submitted one is rejected first; a posted one is reversed.");
    const u = await tx.journalDocument.update({ where: { id }, data: { status: "CANCELLED", decisionNote: reason.trim() } });
    await logAudit(ctx, { action: "JOURNAL_DOC_CANCEL", entity: "JournalDocument", entityId: id, reason }, tx);
    return u;
  });
}

// ───────────────────────────── Approval and posting ─────────────────────────────

/** Whether this organization asks for a second person's approval on manual journals. */
export async function approvalRequired(tx: Tx, orgId: string) {
  return (await tx.organization.findUniqueOrThrow({ where: { id: orgId }, select: { journalApprovalRequired: true } })).journalApprovalRequired;
}

export async function submitDocument(ctx: Ctx, id: string) {
  assertCan(ctx, "journal.manage");
  return db.$transaction(async (tx) => {
    const doc = await load(ctx, tx, id);
    if (!canEditDocument(doc.status as DocumentStatus)) throw new BusinessError(`This journal is ${said(doc.status as DocumentStatus)}, so it can't be submitted.`);
    const problems = draftProblems({ kind: doc.kind, postingDate: doc.postingDate, reverseOn: doc.reverseOn, lines: doc.lines.map((l) => ({ accountId: l.accountId, description: l.description, debit: Number(l.debit), credit: Number(l.credit) })) });
    if (problems.length) throw new BusinessError(problems.slice(0, 3).join(" "));
    await assertNoControlAccounts(tx, ctx.orgId, doc.lines.map((l) => l.accountId));
    await validateJournal(ctx, tx, postingInput(doc)); // refuses for exactly the reasons posting would
    const required = await approvalRequired(tx, ctx.orgId);
    const now = new Date();
    await tx.journalDocument.update({ where: { id }, data: { status: "SUBMITTED", submittedBy: ctx.name, submittedByUserId: ctx.userId, submittedAt: now, decidedBy: null, decidedByUserId: null, decidedAt: null, decisionNote: null } });
    await logAudit(ctx, { action: "JOURNAL_DOC_SUBMIT", entity: "JournalDocument", entityId: id, newValue: { documentNumber: doc.documentNumber, approvalRequired: required } }, tx);
    if (required) return { posted: false as const };
    // approval switched off by the organization: the preparer's own submission stands as the approval, and it is on the record
    await tx.journalDocument.update({ where: { id }, data: { status: "APPROVED", decidedBy: ctx.name, decidedByUserId: ctx.userId, decidedAt: now, decisionNote: "Approval not required (organization setting)." } });
    await logAudit(ctx, { action: "JOURNAL_DOC_APPROVE_WAIVED", entity: "JournalDocument", entityId: id, reason: "Organization setting: manual journals don't need approval" }, tx);
    const journal = await postApproved(ctx, tx, id);
    return { posted: true as const, journal };
  });
}

export async function approveDocument(ctx: Ctx, id: string, note?: string) {
  assertCan(ctx, "journal.approve");
  return db.$transaction(async (tx) => {
    const doc = await load(ctx, tx, id);
    if (doc.status !== "SUBMITTED") throw new BusinessError(`This journal is ${said(doc.status as DocumentStatus)}, so it can't be approved.`);
    if (doc.createdByUserId === ctx.userId || doc.submittedByUserId === ctx.userId) throw new BusinessError("You prepared this journal, so someone else has to approve it.");
    const u = await tx.journalDocument.update({ where: { id }, data: { status: "APPROVED", decidedBy: ctx.name, decidedByUserId: ctx.userId, decidedAt: new Date(), decisionNote: note?.trim() || null } });
    await logAudit(ctx, { action: "JOURNAL_DOC_APPROVE", entity: "JournalDocument", entityId: id, newValue: { documentNumber: doc.documentNumber }, reason: note }, tx);
    return u;
  });
}

export async function rejectDocument(ctx: Ctx, id: string, note: string) {
  assertCan(ctx, "journal.approve");
  if (!note || note.trim().length < 10) throw new BusinessError("Say why it is being returned, so the preparer knows what to fix.");
  return db.$transaction(async (tx) => {
    const doc = await load(ctx, tx, id);
    if (doc.status !== "SUBMITTED" && doc.status !== "APPROVED") throw new BusinessError(`This journal is ${said(doc.status as DocumentStatus)}, so it can't be returned.`);
    const u = await tx.journalDocument.update({ where: { id }, data: { status: "REJECTED", decidedBy: ctx.name, decidedByUserId: ctx.userId, decidedAt: new Date(), decisionNote: note.trim() } });
    await logAudit(ctx, { action: "JOURNAL_DOC_REJECT", entity: "JournalDocument", entityId: id, reason: note }, tx);
    return u;
  });
}

async function postApproved(ctx: Ctx, tx: Tx, id: string) {
  const doc = await load(ctx, tx, id);
  if (doc.status !== "APPROVED") throw new BusinessError(`This journal is ${said(doc.status as DocumentStatus)}, so it can't be posted.`);
  await assertNoControlAccounts(tx, ctx.orgId, doc.lines.map((l) => l.accountId));
  const journal = await postJournal(ctx, tx, postingInput(doc));
  if (!journal) throw new BusinessError("There is nothing to post: the journal has no amounts.");
  await tx.journalDocument.update({ where: { id }, data: { status: "POSTED", journalId: journal.id, postedBy: ctx.name, postedAt: new Date() } });
  await logAudit(ctx, { action: "JOURNAL_DOC_POST", entity: "JournalDocument", entityId: id, newValue: { documentNumber: doc.documentNumber, entryNumber: journal.entryNumber } }, tx);
  return journal;
}

/** Posts an approved journal. Anyone with the approve permission may; it needn't be the approver. */
export async function postDocument(ctx: Ctx, id: string) {
  assertCan(ctx, "journal.approve");
  return db.$transaction((tx) => postApproved(ctx, tx, id));
}

// ───────────────────────────── Reversals ─────────────────────────────

async function originalFor(ctx: Ctx, tx: Tx, journalId: string) {
  const j = await tx.journalEntry.findFirst({
    where: { id: journalId, organizationId: ctx.orgId },
    include: { lines: { orderBy: { sortOrder: "asc" } }, reversedBy: { select: { entryNumber: true } } },
  });
  if (!j) throw new BusinessError("Journal not found.");
  return j;
}

/** The reversal's posting input: the original's lines mirrored on the given date. */
function mirrorInput(original: Awaited<ReturnType<typeof originalFor>>, reverseDate: Date, description: string): PostingInput {
  return {
    source: "JOURNAL_REVERSAL",
    sourceType: "JOURNAL_REVERSAL",
    sourceId: original.id,
    reversalOfId: original.id,
    postingDate: reverseDate,
    description,
    lines: mirrorLines(original.lines),
  };
}

export async function requestReversal(ctx: Ctx, journalId: string, reason: string, reverseDate: string) {
  assertCan(ctx, "journal.manage");
  if (!reason || reason.trim().length < 15) throw new BusinessError("Say why it is being reversed, in a sentence or two. It is recorded.");
  const date = parseDate("The reversal date", reverseDate);
  if (!date) throw new BusinessError("Choose the date the reversal posts on.");
  return db.$transaction(async (tx) => {
    const j = await originalFor(ctx, tx, journalId);
    const r = reversibility({ sourceType: j.sourceType, reversalOfId: j.reversalOfId, reversedByNumber: j.reversedBy?.entryNumber ?? null });
    if (!r.ok) throw new BusinessError(r.reason!);
    if (date < j.postingDate) throw new BusinessError("A reversal can't be dated before the journal it reverses.");
    if (await tx.journalReversal.count({ where: { journalId, status: "PENDING" } })) throw new BusinessError("A reversal of this journal is already waiting for approval.");
    await validateJournal(ctx, tx, mirrorInput(j, date, `Reversal of ${j.entryNumber}`)); // the books must accept that date
    const req = await tx.journalReversal.create({ data: { organizationId: ctx.orgId, journalId, reason: reason.trim(), reverseDate: date, requestedBy: ctx.name, requestedByUserId: ctx.userId } });
    await logAudit(ctx, { action: "JOURNAL_REVERSAL_REQUEST", entity: "JournalEntry", entityId: journalId, newValue: { entryNumber: j.entryNumber, reverseDate }, reason }, tx);
    return req;
  });
}

export async function decideReversal(ctx: Ctx, id: string, approve: boolean, note?: string) {
  assertCan(ctx, "journal.approve");
  return db.$transaction(async (tx) => {
    const req = await tx.journalReversal.findFirst({ where: { id, organizationId: ctx.orgId } });
    if (!req) throw new BusinessError("Request not found.");
    if (req.status !== "PENDING") throw new BusinessError(`This request is already ${req.status.toLowerCase()}.`);
    if (req.requestedByUserId === ctx.userId) throw new BusinessError("You asked for this reversal, so someone else has to approve it.");
    if (!approve) {
      if (!note || note.trim().length < 10) throw new BusinessError("Say why the reversal is being turned down.");
      const u = await tx.journalReversal.update({ where: { id }, data: { status: "REJECTED", decidedBy: ctx.name, decidedByUserId: ctx.userId, decidedAt: new Date(), decisionNote: note.trim() } });
      await logAudit(ctx, { action: "JOURNAL_REVERSAL_REJECT", entity: "JournalEntry", entityId: req.journalId, reason: note }, tx);
      return u;
    }
    const j = await originalFor(ctx, tx, req.journalId);
    const r = reversibility({ sourceType: j.sourceType, reversalOfId: j.reversalOfId, reversedByNumber: j.reversedBy?.entryNumber ?? null });
    if (!r.ok) throw new BusinessError(r.reason!);
    const reversal = await postJournal(ctx, tx, mirrorInput(j, req.reverseDate, `Reversal of ${j.entryNumber}: ${req.reason}`));
    if (!reversal) throw new BusinessError("There is nothing to reverse.");
    const u = await tx.journalReversal.update({ where: { id }, data: { status: "APPROVED", decidedBy: ctx.name, decidedByUserId: ctx.userId, decidedAt: new Date(), decisionNote: note?.trim() || null } });
    await logAudit(ctx, { action: "JOURNAL_REVERSAL_APPROVE", entity: "JournalEntry", entityId: req.journalId, newValue: { original: j.entryNumber, reversal: reversal.entryNumber }, reason: note }, tx);
    return u;
  });
}

/**
 * Posts the automatic reversal of every accrual whose date has come. The reversal was approved along with the accrual,
 * so no further approval is asked. One that can't post (its period is closed) is reported and left, and the others
 * carry on. Safe to run any number of times: an accrual that has been reversed is never reversed again.
 */
export async function postDueReversals(ctx: Ctx, today: Date) {
  const due = await db.journalDocument.findMany({
    where: { organizationId: ctx.orgId, kind: "ACCRUAL", status: "POSTED", reverseOn: { lte: today }, journal: { reversedBy: null } },
    include: { journal: true },
    orderBy: { reverseOn: "asc" },
  });
  let posted = 0;
  const failed: Array<{ documentNumber: string; reason: string }> = [];
  for (const doc of due) {
    try {
      await db.$transaction(async (tx) => {
        const j = await originalFor(ctx, tx, doc.journalId!);
        if (j.reversedBy) return;
        const reversal = await postJournal(ctx, tx, mirrorInput(j, doc.reverseOn!, `Automatic reversal of accrual ${doc.documentNumber} (${j.entryNumber})`));
        if (reversal) {
          await logAudit(ctx, { action: "JOURNAL_ACCRUAL_REVERSE", entity: "JournalDocument", entityId: doc.id, newValue: { accrual: j.entryNumber, reversal: reversal.entryNumber } }, tx);
          posted++;
        }
      });
    } catch (e) {
      failed.push({ documentNumber: doc.documentNumber, reason: e instanceof BusinessError ? e.message : "Unexpected error; see the server log." });
    }
  }
  return { due: due.length, posted, failed };
}

/** For a manual run from the page. */
export async function runDueReversals(ctx: Ctx, today: Date) {
  assertCan(ctx, "journal.approve");
  return postDueReversals(ctx, today);
}

/** For the scheduler: every organization, acting as the system. */
export async function runDueReversalsForAllOrgs(today = new Date()) {
  const orgs = await db.organization.findMany({ select: { id: true, name: true } });
  const out: Array<{ organization: string; due: number; posted: number; failed: number }> = [];
  for (const o of orgs) {
    const r = await postDueReversals({ userId: "system", orgId: o.id, role: "COMPANY_ADMIN", name: "System (automatic reversal)", email: "system@invalid.local", employeeId: null }, new Date(today.toISOString().slice(0, 10) + "T00:00:00Z"));
    out.push({ organization: o.name, due: r.due, posted: r.posted, failed: r.failed.length });
  }
  return out;
}

// ───────────────────────────── Reading ─────────────────────────────

export async function listDocuments(ctx: Ctx, filter: { status?: string } = {}) {
  assertCan(ctx, "gl.view");
  const rows = await db.journalDocument.findMany({
    where: { organizationId: ctx.orgId, ...(filter.status ? { status: filter.status as never } : {}) },
    include: { lines: { select: { debit: true } }, journal: { select: { id: true, entryNumber: true, reversedBy: { select: { entryNumber: true } } } } },
    orderBy: [{ createdAt: "desc" }],
    take: 300,
  });
  return rows.map((r) => ({ ...r, total: round2(r.lines.reduce((s, l) => s + Number(l.debit), 0)) }));
}

export async function getDocument(ctx: Ctx, id: string) {
  assertCan(ctx, "gl.view");
  const doc = await db.journalDocument.findFirst({
    where: { id, organizationId: ctx.orgId },
    include: { lines: { orderBy: { sortOrder: "asc" }, include: { account: { select: { code: true, name: true } } } }, journal: { select: { id: true, entryNumber: true, reversedBy: { select: { id: true, entryNumber: true } } } } },
  });
  return doc;
}

export async function listReversals(ctx: Ctx) {
  assertCan(ctx, "gl.view");
  return db.journalReversal.findMany({
    where: { organizationId: ctx.orgId },
    include: { journal: { select: { id: true, entryNumber: true, description: true, totalDebit: true, postingDate: true, reversedBy: { select: { id: true, entryNumber: true } } } } },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });
}

/** What can be done about one journal: is it reversible, and is a request waiting. */
export async function reversalStateFor(ctx: Ctx, journalId: string) {
  assertCan(ctx, "gl.view");
  const j = await db.journalEntry.findFirst({
    where: { id: journalId, organizationId: ctx.orgId },
    select: { sourceType: true, reversalOfId: true, reversedBy: { select: { id: true, entryNumber: true } }, reversalOf: { select: { id: true, entryNumber: true } }, reversalRequests: { orderBy: { createdAt: "desc" }, take: 5 } },
  });
  if (!j) return null;
  const r = reversibility({ sourceType: j.sourceType, reversalOfId: j.reversalOfId, reversedByNumber: j.reversedBy?.entryNumber ?? null });
  const pending = j.reversalRequests.find((x) => x.status === "PENDING") ?? null;
  return { ...r, reversedBy: j.reversedBy, reversalOf: j.reversalOf, pending, requests: j.reversalRequests, canRequest: r.ok && !pending && can(ctx.role, "journal.manage") };
}

/** Switches the approval requirement on or off. A person with the period-approval permission only; audited. */
export async function setApprovalRequired(ctx: Ctx, required: boolean) {
  assertCan(ctx, "period.approve");
  const old = await approvalRequired(db, ctx.orgId);
  await db.organization.update({ where: { id: ctx.orgId }, data: { journalApprovalRequired: required } });
  await logAudit(ctx, { action: "JOURNAL_APPROVAL_SETTING", entity: "Organization", entityId: ctx.orgId, oldValue: { required: old }, newValue: { required } });
  return required;
}


/** The accounts a manual journal can post to, as choices: active, postable, and not a control account. */
export async function postableAccountOptions(ctx: Ctx) {
  assertCan(ctx, "gl.view");
  const rows = await db.glAccount.findMany({
    where: { organizationId: ctx.orgId, active: true, postable: true, code: { notIn: Object.keys(CONTROL_ACCOUNTS) } },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true },
  });
  return rows.map((a) => ({ value: a.id, label: `${a.code} — ${a.name}` }));
}
