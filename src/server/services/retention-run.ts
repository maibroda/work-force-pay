/**
 * The retention run (governance step 3b-2, docs/plans/hr-governance-step3b2-plan.md): clearing the WORDS of one kind of record for the people (or records) whose period has ended, and
 * keeping the shape. Irreversible once confirmed, so it cannot happen by itself:
 *
 *  1. HR PROPOSES a run for one kind of record. What it covers is fixed then (the people or records past their period under the company's own rule), minus anything a legal hold covers and
 *     anyone with a data request (or, for the kinds counted from leaving, a case) still open. Counts only are shown.
 *  2. A DIFFERENT person (the Company Administrator) CONFIRMS it, no sooner than a minute later. A rule the legal adviser has not verified runs only if the confirmer writes down why they
 *     accept it (recorded and flagged). A rule changed since the proposal must be proposed again. The only holder of the right may confirm their own proposal, with a written reason.
 *  3. Confirming checks everything again (a hold, an open case or an erasure since the proposal removes that item), then clears the words in one transaction and records what was done.
 *
 * Audit carries ids, categories, counts and flags, never a name, a note or a word. The ledger (RetentionRunItem) stops a second run redoing the same items.
 */
import type { Ctx } from "@/lib/auth/context";
import type { Permission } from "@/lib/auth/permissions";
import { ForbiddenError } from "@/lib/auth/permissions";
import { canCtx } from "@/lib/hr-functions";
import { NOTE_MIN, checkProposable, confirmVerdict, isRunnable, reviewWait, type RunnableCategory } from "@/lib/retention-run";
import { RETENTION_CATEGORIES, RETENTION_CATEGORY_LABELS, holdBlocks, type RetentionCategory } from "@/lib/retention-schedule";
import { assertCan, BusinessError, db } from "./_base";
import { logAudit } from "./audit";
import { ANONYMISERS } from "./retention-anonymise";
import { pastSubjects, ruleFor } from "./retention-due";
import { liveHolds } from "./retention-holds";
import { otherHolders } from "./second-person";

/** The welfare and succession lists are opened only by their own function (the HR administrator, or an officer with that function), so proposing a run for them needs it too. */
const CATEGORY_RIGHT: Partial<Record<RunnableCategory, Permission>> = { WELFARE_CASES: "welfare.manage", SUCCESSION: "succession.manage" };

type OpenReason = "OPEN_CASE" | "OPEN_DATA_REQUEST";

/**
 * Who has something still open that means their records should not be cleared now: a data access request (they asked for their data) for every kind, and, for the kinds counted from the
 * day someone left, an employee-relations case not yet closed (erasure refuses the same).
 */
async function openReasons(orgId: string, perPerson: boolean, employeeIds: string[]): Promise<Map<string, OpenReason>> {
  const out = new Map<string, OpenReason>();
  if (!employeeIds.length) return out;
  const requests = await db.dataAccessRequest.findMany({ where: { organizationId: orgId, employeeId: { in: employeeIds }, status: "OPEN" }, select: { employeeId: true }, distinct: ["employeeId"] });
  for (const r of requests) out.set(r.employeeId, "OPEN_DATA_REQUEST");
  if (perPerson) {
    const cases = await db.relationsCase.findMany({ where: { organizationId: orgId, employeeId: { in: employeeIds }, status: { not: "CLOSED" } }, select: { employeeId: true }, distinct: ["employeeId"] });
    for (const c of cases) out.set(c.employeeId, "OPEN_CASE"); // a case outranks a data request in what is reported
  }
  return out;
}

export async function proposeRun(ctx: Ctx, category: string) {
  assertCan(ctx, "hr.manage");
  const right = CATEGORY_RIGHT[category as RunnableCategory];
  if (right) assertCan(ctx, right);
  if (!(RETENTION_CATEGORIES as readonly string[]).includes(category)) throw new BusinessError("Choose a category of record from the list.");
  const cat = category as RetentionCategory;
  const rule = await ruleFor(ctx.orgId, cat);
  const bad = checkProposable(cat, rule);
  if (bad) throw new BusinessError(bad);
  if (await db.retentionRun.findFirst({ where: { organizationId: ctx.orgId, category: cat, status: "PROPOSED" }, select: { id: true } })) {
    throw new BusinessError("A run for this kind of record is already waiting for confirmation. Confirm it or turn it down first.");
  }

  const { past, kind } = await pastSubjects(ctx.orgId, cat);
  if (!past.length) throw new BusinessError("Nothing is due to run: no record of this kind has reached the end of its period.");
  const holds = await liveHolds(ctx.orgId);
  const unheld = past.filter((s) => !holdBlocks(holds, { category: cat, employeeId: s.employeeId }));
  const skippedHeld = past.length - unheld.length;
  const open = await openReasons(ctx.orgId, kind === "PERSON", [...new Set(unheld.map((s) => s.employeeId))]);
  const covered = unheld.filter((s) => !open.has(s.employeeId));
  const skippedOpen = unheld.length - covered.length;
  if (!covered.length) throw new BusinessError("Nothing is due to run: everything past its period is held by a legal hold or has a case or a data request still open.");

  const verified = (await db.retentionRule.findUnique({ where: { organizationId_category: { organizationId: ctx.orgId, category: cat } }, select: { verifiedOn: true } }))?.verifiedOn != null;
  return db.$transaction(async (tx) => {
    const run = await tx.retentionRun.create({
      data: {
        organizationId: ctx.orgId,
        category: cat,
        periodMonths: rule.periodMonths,
        trigger: rule.trigger,
        action: rule.action,
        ruleVerified: verified,
        itemCount: covered.length,
        skippedHeld,
        skippedOpen,
        proposedByUserId: ctx.userId,
        proposedBy: ctx.name,
      },
    });
    await tx.retentionRunItem.createMany({ data: covered.map((s) => ({ organizationId: ctx.orgId, runId: run.id, category: cat, subjectId: s.subjectId, employeeId: s.employeeId })) });
    await logAudit(ctx, { action: "RETENTION_RUN_PROPOSE", entity: "RetentionRun", entityId: run.id, newValue: { category: cat, items: covered.length, skippedHeld, skippedOpen, periodMonths: rule.periodMonths, trigger: rule.trigger, ruleVerified: verified } }, tx);
    return run;
  });
}

export async function confirmRun(ctx: Ctx, id: string, note: string) {
  assertCan(ctx, "retention.manage");
  const run = await db.retentionRun.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!run) throw new BusinessError("Run not found.");
  const cat = run.category as RetentionCategory;
  if (!isRunnable(cat)) throw new BusinessError("This kind of record has no run.");

  const [rule, ruleRow] = await Promise.all([ruleFor(ctx.orgId, cat), db.retentionRule.findUnique({ where: { organizationId_category: { organizationId: ctx.orgId, category: cat } }, select: { verifiedOn: true } })]);
  const verified = ruleRow?.verifiedOn != null;
  const samePerson = run.proposedByUserId === ctx.userId;
  const verdict = confirmVerdict({
    status: run.status,
    ruleChanged: rule.periodMonths !== run.periodMonths || rule.trigger !== run.trigger || rule.action !== run.action,
    ruleVerified: verified,
    samePerson,
    otherHolders: samePerson ? await otherHolders(ctx, "retention.manage") : 0,
    note,
    waitSeconds: reviewWait(run.proposedAt, new Date()),
  });
  if (!verdict.ok) throw new BusinessError(verdict.error);

  // check everything again: a hold, an open case or data request, or an erasure since the proposal takes that item out of the run
  const items = await db.retentionRunItem.findMany({ where: { runId: id } });
  const holds = await liveHolds(ctx.orgId);
  const perPerson = !(cat === "WELFARE_CASES" && run.trigger === "AFTER_CLOSURE") && !(cat === "SUCCESSION" && run.trigger === "AFTER_RECORD_DATE");
  const employeeIds = [...new Set(items.map((i) => i.employeeId).filter((e): e is string => !!e))];
  const erased = new Set((await db.employee.findMany({ where: { organizationId: ctx.orgId, id: { in: employeeIds }, anonymizedAt: { not: null } }, select: { id: true } })).map((e) => e.id));
  const open = await openReasons(ctx.orgId, perPerson, employeeIds);
  const reasonFor = (i: (typeof items)[number]): string | null => {
    if (i.employeeId && erased.has(i.employeeId)) return "ERASED";
    if (holdBlocks(holds, { category: cat, employeeId: i.employeeId })) return "HOLD";
    return (i.employeeId && open.get(i.employeeId)) || null;
  };
  const decided = items.map((i) => ({ item: i, reason: reasonFor(i) }));
  const clear = decided.filter((d) => !d.reason).map((d) => d.item);
  const skipped = decided.filter((d) => d.reason);

  const now = new Date();
  return db.$transaction(async (tx) => {
    // claim it first, so two confirmations at once cannot both run
    const claimed = await tx.retentionRun.updateMany({
      where: { id, organizationId: ctx.orgId, status: "PROPOSED" },
      data: { status: "EXECUTED", decidedAt: now, decidedByUserId: ctx.userId, decidedBy: ctx.name, decisionNote: note.trim(), acceptedUnverified: verdict.acceptedUnverified, singleHolder: verdict.singleHolder, ruleVerified: verified },
    });
    if (claimed.count !== 1) throw new BusinessError("This run is already executed.");
    const counts: Record<string, number> = {};
    if (clear.length) {
      const target = perPerson ? { employeeIds: clear.map((i) => i.subjectId) } : { recordIds: clear.map((i) => i.subjectId) };
      Object.assign(counts, await ANONYMISERS[cat](tx, ctx.orgId, target));
      await tx.retentionRunItem.updateMany({ where: { id: { in: clear.map((i) => i.id) } }, data: { clearedAt: now } });
    }
    for (const s of skipped) await tx.retentionRunItem.update({ where: { id: s.item.id }, data: { skippedReason: s.reason } });
    const done = await tx.retentionRun.update({ where: { id }, data: { clearedItems: clear.length, skippedAtConfirm: skipped.length, summary: counts } });
    const byReason: Record<string, number> = {};
    for (const s of skipped) byReason[s.reason!] = (byReason[s.reason!] ?? 0) + 1;
    await logAudit(
      ctx,
      {
        action: "RETENTION_RUN_EXECUTE",
        entity: "RetentionRun",
        entityId: id,
        newValue: { category: cat, cleared: clear.length, skipped: skipped.length, skippedByReason: byReason, periodMonths: run.periodMonths, trigger: run.trigger, ruleVerified: verified, acceptedUnverified: verdict.acceptedUnverified, singleHolder: verdict.singleHolder },
      },
      tx,
    );
    return done;
  });
}

/** Turning a proposal down: the Company Administrator, or the person who proposed it (to withdraw it). Clears nothing. */
export async function rejectRun(ctx: Ctx, id: string, note: string) {
  const run = await db.retentionRun.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!run) throw new BusinessError("Run not found.");
  const mayManage = canCtx(ctx, "retention.manage");
  const proposer = run.proposedByUserId === ctx.userId && canCtx(ctx, "hr.manage");
  if (!mayManage && !proposer) throw new ForbiddenError("retention.manage");
  if (note.trim().length < NOTE_MIN) throw new BusinessError(`Give the reason it is being turned down (at least ${NOTE_MIN} characters).`);
  if (run.status !== "PROPOSED") throw new BusinessError(`This run is already ${run.status.toLowerCase()}.`);
  await db.$transaction(async (tx) => {
    const done = await tx.retentionRun.updateMany({
      where: { id, organizationId: ctx.orgId, status: "PROPOSED" },
      data: { status: "REJECTED", decidedAt: new Date(), decidedByUserId: ctx.userId, decidedBy: ctx.name, decisionNote: note.trim() },
    });
    if (done.count !== 1) throw new BusinessError("This run is already executed.");
    await logAudit(ctx, { action: "RETENTION_RUN_REJECT", entity: "RetentionRun", entityId: id, newValue: { category: run.category, items: run.itemCount } }, tx);
  });
}

/** The runs of this company, newest first: counts and flags, never a name or a word. */
export async function listRuns(ctx: Ctx) {
  assertCan(ctx, "hr.view");
  const rows = await db.retentionRun.findMany({ where: { organizationId: ctx.orgId }, orderBy: { proposedAt: "desc" }, take: 100 });
  const now = new Date();
  return {
    runs: rows.map((r) => ({
      id: r.id,
      category: r.category as RetentionCategory,
      label: RETENTION_CATEGORY_LABELS[r.category as RetentionCategory],
      status: r.status,
      periodMonths: r.periodMonths,
      ruleVerified: r.ruleVerified,
      itemCount: r.itemCount,
      skippedHeld: r.skippedHeld,
      skippedOpen: r.skippedOpen,
      proposedBy: r.proposedBy,
      proposedAt: r.proposedAt,
      /** The viewer proposed it. */
      mine: r.proposedByUserId === ctx.userId,
      decidedBy: r.decidedBy,
      decidedAt: r.decidedAt,
      decisionNote: r.decisionNote,
      acceptedUnverified: r.acceptedUnverified,
      singleHolder: r.singleHolder,
      clearedItems: r.clearedItems,
      skippedAtConfirm: r.skippedAtConfirm,
      summary: r.summary as Record<string, number> | null,
      waitSeconds: r.status === "PROPOSED" ? reviewWait(r.proposedAt, now) : 0,
    })),
  };
}
