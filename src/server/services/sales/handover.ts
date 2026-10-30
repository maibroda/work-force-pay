/**
 * The handover of an accepted quote to Operations. The client's acceptance of a quote starts a DRAFT handover with the sites and posts copied from the quote
 * (what was billed, what the shifts need, the shift, the bill rate: never the cost or margin). Sales completes it and sends it; a person in Operations who is
 * formally designated, and who did not prepare it, either returns it with a question or accepts it. Only on acceptance are the client, a DRAFT contract, the
 * contract rates and the sites made, through the same record-making functions the Clients screens use, all in one transaction: if any step fails, none is made.
 * Once accepted nothing can change (the database refuses). Audit entries carry ids, numbers, counts and field names, never the people or notes entered.
 */
import type { CrmHandover } from "@prisma/client";
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { can, type Role } from "@/lib/auth/permissions";
import { contractPlan, equipmentSchema, groupSites, missingForSubmit, serviceLevelSchema, termEnd, type Equipment, type HandoverFacts, type ServiceLevel } from "@/lib/sales/handover";
import { normalizeNgPhone } from "@/lib/sales/phone";
import { BusinessError, db, type Tx } from "../_base";
import { logAudit } from "../audit";
import { addContractRateRecord, beatSchema, clientSchema, contractRateSchema, contractSchema, createBeatRecord, createClientRecord, createContractRecord } from "../clients";
import { nextNumber } from "../numbering";
import { ownerFilter, requireSales } from "./access";
import { fireEvent } from "./automation";

/** The writes of a handover are several statements (one per site and post); a transaction is cut off after five seconds unless told otherwise, which is too short on a busy server. Reading back is done after the transaction. */
const TX = { timeout: 20_000, maxWait: 10_000 } as const;
const isoDate = (dt: Date | null) => (dt ? dt.toISOString().slice(0, 10) : null);
const day = (s: string) => new Date(`${s}T00:00:00Z`);

// ─────────────────────────────── loading and shaping ───────────────────────────────

async function loadRow(ctx: Ctx, tx: Tx | typeof db, id: string) {
  const h = await tx.crmHandover.findFirst({ where: { id, organizationId: ctx.orgId, opportunity: { ...ownerFilter(ctx) } } });
  if (!h) throw new BusinessError("Handover not found.");
  return h;
}

async function shape(tx: Tx | typeof db, h: CrmHandover) {
  const [sites, posts, events] = await Promise.all([
    tx.crmHandoverSite.findMany({ where: { handoverId: h.id }, orderBy: { sortOrder: "asc" } }),
    tx.crmHandoverPost.findMany({ where: { handoverId: h.id }, orderBy: { sortOrder: "asc" } }),
    tx.crmHandoverEvent.findMany({ where: { handoverId: h.id }, orderBy: [{ at: "asc" }, { id: "asc" }] }),
  ]);
  const full = {
    ...h,
    serviceLevels: h.serviceLevels as unknown as ServiceLevel[],
    sites: sites.map((s) => ({ ...s, equipment: s.equipment as unknown as Equipment[], posts: posts.filter((p) => p.siteId === s.id) })),
    events,
  };
  return { ...full, missing: missingForSubmit(factsOf(full)) };
}

function factsOf(h: { scope: string | null; clientRequirements: string | null; startDate: Date | null; termMonths: number | null; noSpecialSla: boolean; serviceLevels: ServiceLevel[]; sites: Array<{ id: string; name: string; address: string | null; state: string | null; lga: string | null; contactName: string | null; contactPhoneE164: string | null; equipment: Equipment[]; noEquipment: boolean; posts: Array<{ postLabel: string | null; categoryId: string | null; salaryStructureId: string; billPerHead: { toFixed: (n: number) => string }; operativeSharePct: { toFixed: (n: number) => string }; businessLine: string; headcount: number; requiredPersonnel: number }> }> }): HandoverFacts {
  return {
    scope: h.scope,
    clientRequirements: h.clientRequirements,
    startDate: isoDate(h.startDate),
    termMonths: h.termMonths,
    noSpecialSla: h.noSpecialSla,
    serviceLevels: h.serviceLevels,
    sites: h.sites.map((s) => ({
      id: s.id, name: s.name, address: s.address, state: s.state, lga: s.lga, contactName: s.contactName, contactPhoneE164: s.contactPhoneE164, equipment: s.equipment, noEquipment: s.noEquipment,
      posts: s.posts.map((p) => ({ postLabel: p.postLabel, categoryId: p.categoryId, structureId: p.salaryStructureId, billPerHead: p.billPerHead.toFixed(2), operativeSharePct: p.operativeSharePct.toFixed(2), businessLine: p.businessLine, headcount: p.headcount, requiredPersonnel: p.requiredPersonnel })),
    })),
  };
}

const event = (tx: Tx, ctx: Ctx, h: { id: string; organizationId: string }, kind: "CREATED" | "SUBMITTED" | "RETURNED" | "ACCEPTED", revisionNo: number, note?: string | null) =>
  tx.crmHandoverEvent.create({ data: { organizationId: h.organizationId, handoverId: h.id, kind, revisionNo, byUserId: ctx.userId, byName: ctx.name, note: note ?? null } });

// ─────────────────────────────── starting a handover ───────────────────────────────

/**
 * Starts the handover for an accepted quote, inside the transaction that accepts it (or on its own). One per deal: if there is one already it is returned.
 * A quote that is not accepted, or that is below the minimum margin without the approval that was needed, cannot start one.
 */
export async function createHandoverInTx(ctx: Ctx, tx: Tx, quote: { id: string; opportunityId: string; status: string; number: string; versionNo: number; monthlyBill: { toString: () => string }; validUntil: Date | null; belowMinimum: boolean; belowMarginApproved: boolean }) {
  if (quote.status !== "ACCEPTED") throw new BusinessError("Only a quote the client has accepted can start a handover.");
  if (quote.belowMinimum && !quote.belowMarginApproved) throw new BusinessError("This quote is below the minimum margin and was never given the approval it needed, so it cannot start a handover.");
  const existing = await tx.crmHandover.findFirst({ where: { opportunityId: quote.opportunityId } });
  if (existing) {
    if (existing.quoteId !== quote.id) throw new BusinessError("This deal already has a handover, from another quote.");
    return existing;
  }
  const deal = await tx.crmOpportunity.findFirstOrThrow({ where: { id: quote.opportunityId, organizationId: ctx.orgId } });
  const lines = await tx.crmQuoteLine.findMany({ where: { quoteId: quote.id }, orderBy: { sortOrder: "asc" } });
  if (!lines.length) throw new BusinessError("A quote needs at least one line.");
  const number = await nextNumber(tx, ctx.orgId, "SALES_HANDOVER");
  const h = await tx.crmHandover.create({
    data: {
      organizationId: ctx.orgId, number, opportunityId: deal.id, quoteId: quote.id, accountId: deal.accountId, quoteNumber: quote.number, quoteVersion: quote.versionNo,
      monthlyBill: quote.monthlyBill.toString(), validUntil: quote.validUntil, termMonths: deal.contractTermMonths, startDate: deal.expectedStartDate,
      preparedBy: deal.ownerName, preparedByUserId: deal.ownerUserId,
    },
  });
  const groups = groupSites(lines);
  let order = 0;
  for (const [i, g] of groups.entries()) {
    const site = await tx.crmHandoverSite.create({ data: { handoverId: h.id, sortOrder: i + 1, name: g.name, address: g.address } });
    await tx.crmHandoverPost.createMany({
      data: g.lines.map((l) => ({
        handoverId: h.id, siteId: site.id, quoteLineId: l.id, sortOrder: ++order, postLabel: l.postLabel, shiftPattern: l.shiftPattern, salaryStructureId: l.salaryStructureId, structureName: l.structureName,
        businessLine: l.businessLine, headcount: l.headcount, requiredPersonnel: l.requiredPersonnel, billPerHead: l.billPerHead, operativeSharePct: l.operativeSharePct,
      })),
    });
  }
  await event(tx, ctx, h, "CREATED", 1);
  await logAudit(ctx, { action: "SALES_HANDOVER_CREATE", entity: "CrmHandover", entityId: h.id, newValue: { number, quoteVersion: quote.versionNo, sites: groups.length, posts: lines.length } }, tx);
  return h;
}

/** Starts the handover of an accepted quote (it is also started automatically when the quote is accepted). */
export async function createHandoverForQuote(ctx: Ctx, quoteId: string) {
  await requireSales(ctx, "sales.manage");
  return db.$transaction(async (tx: Tx) => {
    const q = await tx.crmQuote.findFirst({ where: { id: quoteId, organizationId: ctx.orgId, opportunity: { ...ownerFilter(ctx) } } });
    if (!q) throw new BusinessError("Quote not found.");
    return createHandoverInTx(ctx, tx, q);
  });
}

// ─────────────────────────────── reading ───────────────────────────────

export async function getHandover(ctx: Ctx, id: string) {
  await requireSales(ctx, "sales.view");
  return shape(db, await loadRow(ctx, db, id));
}

export async function getHandoverForDeal(ctx: Ctx, opportunityId: string) {
  await requireSales(ctx, "sales.view");
  const h = await db.crmHandover.findFirst({ where: { opportunityId, organizationId: ctx.orgId, opportunity: { ...ownerFilter(ctx) } } });
  return h ? shape(db, h) : null;
}

export async function listHandovers(ctx: Ctx, f: { status?: "DRAFT" | "SUBMITTED" | "RETURNED" | "ACCEPTED" } = {}) {
  await requireSales(ctx, "sales.view");
  return db.crmHandover.findMany({
    where: { organizationId: ctx.orgId, opportunity: { ...ownerFilter(ctx) }, ...(f.status ? { status: f.status } : {}) },
    include: { opportunity: { select: { name: true, account: { select: { name: true } } } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
}

// ─────────────────────────────── preparing and sending ───────────────────────────────

const optText = (max: number) => z.string().trim().max(max).optional();
export const saveSchema = z.object({
  scope: optText(4000),
  clientRequirements: optText(4000),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2027-01-01").optional(),
  termMonths: z.number().int("The term is a whole number of months").min(1, "The term is at least 1 month").max(240, "The term is at most 240 months").optional(),
  noSpecialSla: z.boolean().optional(),
  serviceLevels: z.array(serviceLevelSchema).max(50).optional(),
  sites: z
    .array(
      z.object({
        id: z.string().min(1),
        address: optText(400),
        state: optText(100),
        lga: optText(100),
        contactName: optText(150),
        contactRole: optText(100),
        contactPhone: optText(40),
        contactEmail: z.union([z.string().trim().email("The site contact's email is not valid"), z.literal("")]).optional(),
        equipment: z.array(equipmentSchema).max(50).optional(),
        noEquipment: z.boolean().optional(),
      }),
    )
    .optional(),
  posts: z.array(z.object({ id: z.string().min(1), categoryId: z.string().min(1) })).optional(),
});
export type SaveInput = z.input<typeof saveSchema>;

const nul = (s: string | undefined) => (s === undefined ? undefined : s.trim() || null);
const EDITABLE = ["DRAFT", "RETURNED"];

/** Sales enters (or changes) what the handover needs. Only while it is a draft or has been returned; every save is a new revision. */
export async function saveHandover(ctx: Ctx, id: string, raw: SaveInput) {
  await requireSales(ctx, "sales.manage");
  const parsed = saveSchema.safeParse(raw);
  if (!parsed.success) throw new BusinessError(parsed.error.issues[0].message);
  const v = parsed.data;
  await db.$transaction(async (tx: Tx) => {
    const h = await loadRow(ctx, tx, id);
    if (!EDITABLE.includes(h.status)) throw new BusinessError("A handover that has been sent can only be changed after Operations returns it with a question.");
    const siteIds = new Set((await tx.crmHandoverSite.findMany({ where: { handoverId: id }, select: { id: true } })).map((s) => s.id));
    const postIds = new Set((await tx.crmHandoverPost.findMany({ where: { handoverId: id }, select: { id: true } })).map((p) => p.id));
    for (const s of v.sites ?? []) if (!siteIds.has(s.id)) throw new BusinessError("Site not found in this handover.");
    for (const p of v.posts ?? []) if (!postIds.has(p.id)) throw new BusinessError("Post not found in this handover.");
    if (v.posts?.length) {
      const wanted = [...new Set(v.posts.map((p) => p.categoryId))];
      const found = await tx.employeeCategory.count({ where: { organizationId: ctx.orgId, id: { in: wanted } } });
      if (found !== wanted.length) throw new BusinessError("Employee category not found.");
    }
    for (const s of v.sites ?? []) {
      let phone: string | null | undefined;
      if (s.contactPhone !== undefined) {
        if (!s.contactPhone.trim()) phone = null;
        else {
          const r = normalizeNgPhone(s.contactPhone);
          if (!r.ok) throw new BusinessError(`The site contact's phone number is not valid: ${r.reason}`);
          phone = r.e164;
        }
      }
      await tx.crmHandoverSite.update({
        where: { id: s.id },
        data: {
          address: nul(s.address), state: nul(s.state), lga: nul(s.lga), contactName: nul(s.contactName), contactRole: nul(s.contactRole), contactPhoneE164: phone,
          contactEmail: s.contactEmail === undefined ? undefined : s.contactEmail.trim() || null,
          equipment: s.equipment, noEquipment: s.noEquipment,
        },
      });
    }
    for (const p of v.posts ?? []) await tx.crmHandoverPost.update({ where: { id: p.id }, data: { categoryId: p.categoryId } });
    await tx.crmHandover.update({
      where: { id },
      data: {
        scope: nul(v.scope), clientRequirements: nul(v.clientRequirements), startDate: v.startDate ? day(v.startDate) : undefined, termMonths: v.termMonths, noSpecialSla: v.noSpecialSla, serviceLevels: v.serviceLevels,
        revisionNo: { increment: 1 },
      },
    });
    const fields = Object.keys(v).filter((k) => (v as Record<string, unknown>)[k] !== undefined).sort();
    await logAudit(ctx, { action: "SALES_HANDOVER_SAVE", entity: "CrmHandover", entityId: id, newValue: { fields, revisionNo: h.revisionNo + 1 } }, tx);
  }, TX);
  return shape(db, await loadRow(ctx, db, id));
}

/** Sales sends the complete handover to Operations. */
export async function submitHandover(ctx: Ctx, id: string) {
  await requireSales(ctx, "sales.manage");
  await db.$transaction(async (tx: Tx) => {
    const h = await loadRow(ctx, tx, id);
    if (!EDITABLE.includes(h.status)) throw new BusinessError("Only a draft or returned handover can be sent to Operations.");
    const s = await shape(tx, h);
    if (s.missing.length) throw new BusinessError(`The handover is not complete yet. Still needed: ${s.missing.join("; ")}.`);
    const wanted = [...new Set(s.sites.flatMap((x) => x.posts.map((p) => p.categoryId!)))];
    if ((await tx.employeeCategory.count({ where: { organizationId: ctx.orgId, id: { in: wanted } } })) !== wanted.length) throw new BusinessError("An employee category chosen for a post no longer exists. Choose it again.");
    await tx.crmHandover.update({ where: { id }, data: { status: "SUBMITTED", submittedRevision: h.revisionNo, submittedAt: new Date(), submittedBy: ctx.name, submittedByUserId: ctx.userId, returnedAt: null, returnedBy: null, returnNote: null } });
    await event(tx, ctx, h, "SUBMITTED", h.revisionNo);
    await logAudit(ctx, { action: "SALES_HANDOVER_SUBMIT", entity: "CrmHandover", entityId: id, newValue: { revisionNo: h.revisionNo } }, tx);
  }, TX);
  return shape(db, await loadRow(ctx, db, id));
}

// ─────────────────────────────── the handshake: Operations ───────────────────────────────

/** Only a person in Operations who has been formally designated (and whose role may accept handovers) can act for Operations. */
async function requireAcceptor(ctx: Ctx) {
  await requireSales(ctx, "sales.handover.accept");
  const mine = await db.crmHandoverAcceptor.findFirst({ where: { organizationId: ctx.orgId, userId: ctx.userId, active: true } });
  if (!mine) {
    const any = await db.crmHandoverAcceptor.count({ where: { organizationId: ctx.orgId, active: true } });
    throw new BusinessError(
      any
        ? "Only a designated person in Operations (the Executive Director, Operations, or the Operations Manager) may accept or return a handover. The company administrator designates them under Sales Settings."
        : "No one has been designated to accept handovers yet, so none can be accepted. The company administrator designates them under Sales Settings.",
    );
  }
}

async function assertNotMaker(ctx: Ctx, h: { preparedByUserId: string; submittedByUserId: string | null; quoteId: string }) {
  const quote = await db.crmQuote.findUniqueOrThrow({ where: { id: h.quoteId }, select: { createdByUserId: true } });
  if ([h.preparedByUserId, h.submittedByUserId, quote.createdByUserId].includes(ctx.userId))
    throw new BusinessError("You prepared or sent this handover (or made its quote), so someone else in Operations must accept or return it.");
}

/** Operations sends the handover back to Sales with a question. Sales answers by changing it and sending it again. */
export async function returnHandover(ctx: Ctx, id: string, note: string) {
  await requireAcceptor(ctx);
  const h = await loadRow(ctx, db, id);
  if (!note?.trim()) throw new BusinessError("Say what Operations needs to know: write the question or the reason for returning it.");
  if (h.status !== "SUBMITTED") throw new BusinessError("Only a handover that has been sent can be returned.");
  await assertNotMaker(ctx, h);
  await db.$transaction(async (tx: Tx) => {
    const cur = await loadRow(ctx, tx, id);
    if (cur.status !== "SUBMITTED") throw new BusinessError("Only a handover that has been sent can be returned.");
    await tx.crmHandover.update({ where: { id }, data: { status: "RETURNED", returnedAt: new Date(), returnedBy: ctx.name, returnNote: note.trim() } });
    await event(tx, ctx, cur, "RETURNED", cur.revisionNo, note.trim());
    await logAudit(ctx, { action: "SALES_HANDOVER_RETURN", entity: "CrmHandover", entityId: id, newValue: { revisionNo: cur.revisionNo } }, tx);
  }, TX);
  return shape(db, await loadRow(ctx, db, id));
}

/**
 * Operations accepts the handover it was sent, and the client, a DRAFT contract, the contract rates and the sites are made, all together or not at all.
 * Accepting an accepted handover again changes nothing. `existingClientId` links a client that already exists instead of making one.
 */
export async function acceptHandover(ctx: Ctx, id: string, opts: { note?: string; existingClientId?: string } = {}) {
  await requireAcceptor(ctx);
  const first = await loadRow(ctx, db, id);
  if (first.status === "ACCEPTED") return shape(db, first);
  if (first.status !== "SUBMITTED") throw new BusinessError("Only a handover that has been sent can be accepted.");
  if (first.submittedRevision !== first.revisionNo) throw new BusinessError("This handover has been changed since it was sent. Ask Sales to send it again.");
  await assertNotMaker(ctx, first);
  const note = opts.note?.trim() || null;

  await db.$transaction(
    async (tx: Tx) => {
      await tx.$queryRaw`select "id" from "CrmHandover" where "id" = ${id} for update`; // two people accepting at once: the second waits, then sees it accepted
      const h = await loadRow(ctx, tx, id);
      if (h.status === "ACCEPTED") return;
      if (h.status !== "SUBMITTED" || h.submittedRevision !== h.revisionNo) throw new BusinessError("This handover has been changed since it was sent. Ask Sales to send it again.");
      const s = await shape(tx, h);
      if (s.missing.length) throw new BusinessError(`The handover is not complete: ${s.missing.join("; ")}.`);
      const plan = contractPlan(factsOf(s));
      const account = await tx.crmAccount.findFirstOrThrow({ where: { id: h.accountId, organizationId: ctx.orgId } });
      const deal = await tx.crmOpportunity.findFirstOrThrow({ where: { id: h.opportunityId, organizationId: ctx.orgId } });
      const start = isoDate(h.startDate)!;

      // the client: the one chosen, the account's own, or a new one (never a second one of the same name by accident)
      let clientId = opts.existingClientId ?? account.clientId ?? null;
      if (clientId) {
        if (!(await tx.client.findFirst({ where: { id: clientId, organizationId: ctx.orgId }, select: { id: true } }))) throw new BusinessError("Client not found.");
      } else {
        const clash = await tx.client.findFirst({ where: { organizationId: ctx.orgId, name: { equals: account.name, mode: "insensitive" } }, select: { code: true } });
        if (clash) throw new BusinessError(`A client named "${account.name}" already exists (${clash.code}). Choose it to link this handover to it, instead of making a second client.`);
        clientId = (await createClientRecord(ctx, tx, clientSchema.parse({ name: account.name, address: account.address ?? undefined }), { idsOnlyAudit: true })).id;
      }
      const contract = await createContractRecord(
        ctx, tx,
        contractSchema.parse({ clientId, name: deal.name, startDate: start, endDate: termEnd(start, h.termMonths!), billingMethod: "PER_HEAD_MONTHLY", status: "DRAFT", businessLine: plan.businessLine, defaultStructureId: plan.structureId ?? undefined, notes: `From handover ${h.number} (quote ${h.quoteNumber}, version ${h.quoteVersion}).` }),
        { idsOnlyAudit: true },
      );
      for (const r of plan.rates)
        await addContractRateRecord(ctx, tx, contractRateSchema.parse({ contractId: contract.id, categoryId: r.categoryId, salaryStructureId: r.structureId, agreedRate: r.agreedRate, operativeSharePct: r.operativeSharePct, effectiveFrom: start }));
      const strength = new Map(plan.beats.map((b) => [b.siteId, b.approvedStrength]));
      for (const site of s.sites) {
        const contact = [site.contactName, site.contactRole ? `(${site.contactRole})` : null, site.contactPhoneE164, site.contactEmail].filter(Boolean).join(" ");
        const beat = await createBeatRecord(
          ctx, tx,
          beatSchema.parse({ contractId: contract.id, name: site.name, state: site.state, lga: site.lga, address: site.address, siteContact: contact || undefined, approvedStrength: strength.get(site.id) ?? 0, startDate: start }),
          { idsOnlyAudit: true },
        );
        await tx.crmHandoverSite.update({ where: { id: site.id }, data: { beatId: beat.id } });
      }
      await tx.crmAccount.update({ where: { id: account.id }, data: { clientId, accountType: "CLIENT" } });
      await tx.crmHandover.update({ where: { id }, data: { status: "ACCEPTED", acceptedAt: new Date(), acceptedBy: ctx.name, acceptedByUserId: ctx.userId, acceptanceNote: note, acceptedRevision: h.revisionNo, clientId, contractId: contract.id } });
      // the start date and term agreed in the handover become the deal's (the Won stage needs them)
      await tx.crmOpportunity.update({ where: { id: deal.id }, data: { lastActivityAt: new Date(), expectedStartDate: h.startDate, contractTermMonths: h.termMonths } });
      await event(tx, ctx, h, "ACCEPTED", h.revisionNo, note);
      await logAudit(ctx, { action: "SALES_HANDOVER_ACCEPT", entity: "CrmHandover", entityId: id, newValue: { number: h.number, clientId, contractId: contract.id, rates: plan.rates.length, sites: s.sites.length, revisionNo: h.revisionNo } }, tx);
    },
    { timeout: 30_000, maxWait: 10_000 }, // several records are made together; the default five seconds is for one
  );
  const done = await shape(db, await loadRow(ctx, db, id));
  if (first.status === "SUBMITTED") await fireEvent(ctx.orgId, "HANDOVER_ACCEPTED", first.opportunityId, first.id); // rules for this event; never throws
  return done;
}

// ─────────────────────────────── the designated acceptors ───────────────────────────────

export async function listAcceptors(ctx: Ctx) {
  await requireSales(ctx, "sales.view");
  return db.crmHandoverAcceptor.findMany({ where: { organizationId: ctx.orgId, active: true }, orderBy: { userName: "asc" } });
}

/** Names a person (the Executive Director, Operations, or the Operations Manager) as someone who may accept handovers. Only the company administrator does this. */
export async function designateAcceptor(ctx: Ctx, userId: string) {
  await requireSales(ctx, "sales.configure");
  const user = await db.user.findFirst({ where: { id: userId, organizationId: ctx.orgId, active: true }, select: { id: true, name: true, role: true } });
  if (!user) throw new BusinessError("That person is not an active user of this organization.");
  if (!can(user.role as Role, "sales.handover.accept")) throw new BusinessError(`${user.name} cannot accept handovers: their role does not allow it. Choose someone in Operations.`);
  const existing = await db.crmHandoverAcceptor.findUnique({ where: { organizationId_userId: { organizationId: ctx.orgId, userId } } });
  if (existing?.active) return existing;
  const rec = existing
    ? await db.crmHandoverAcceptor.update({ where: { id: existing.id }, data: { active: true, userName: user.name, designatedBy: ctx.name, designatedAt: new Date(), removedBy: null, removedAt: null } })
    : await db.crmHandoverAcceptor.create({ data: { organizationId: ctx.orgId, userId, userName: user.name, designatedBy: ctx.name } });
  await logAudit(ctx, { action: "SALES_HANDOVER_ACCEPTOR_DESIGNATE", entity: "CrmHandoverAcceptor", entityId: rec.id, newValue: { userId } });
  return rec;
}

export async function removeAcceptor(ctx: Ctx, id: string) {
  await requireSales(ctx, "sales.configure");
  const rec = await db.crmHandoverAcceptor.findFirst({ where: { id, organizationId: ctx.orgId, active: true } });
  if (!rec) throw new BusinessError("Acceptor not found.");
  await db.crmHandoverAcceptor.update({ where: { id }, data: { active: false, removedBy: ctx.name, removedAt: new Date() } });
  await logAudit(ctx, { action: "SALES_HANDOVER_ACCEPTOR_REMOVE", entity: "CrmHandoverAcceptor", entityId: id, oldValue: { userId: rec.userId } });
}
