import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { d } from "@/lib/dates";
import { assertCan, BusinessError, db, type Tx } from "./_base";
import { logAudit } from "./audit";
import { nextNumber } from "./numbering";

const opt = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));

// ───────────────────────────── Clients ─────────────────────────────

export const clientSchema = z.object({
  name: z.string().trim().min(2, "Client name is required"),
  code: opt,
  contactPerson: opt,
  address: opt,
  phone: opt,
  email: z
    .string()
    .trim()
    .email()
    .optional()
    .or(z.literal("").transform(() => undefined)),
  status: z.enum(["ACTIVE", "INACTIVE", "SUSPENDED", "CLOSED"]).default("ACTIVE"),
  startDate: opt,
  endDate: opt,
});

export async function createClient(ctx: Ctx, raw: z.input<typeof clientSchema>) {
  assertCan(ctx, "client.manage");
  const v = clientSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const code = v.code?.toUpperCase() ?? (await nextNumber(tx, ctx.orgId, "CLIENT"));
    const c = await tx.client.create({
      data: {
        organizationId: ctx.orgId,
        code,
        name: v.name,
        contactPerson: v.contactPerson,
        address: v.address,
        phone: v.phone,
        email: v.email,
        status: v.status,
        startDate: v.startDate ? d(v.startDate) : null,
        endDate: v.endDate ? d(v.endDate) : null,
      },
    });
    await logAudit(ctx, { action: "CLIENT_CREATE", entity: "Client", entityId: c.id, newValue: c }, tx);
    return c;
  });
}

export async function updateClient(ctx: Ctx, id: string, raw: z.input<typeof clientSchema>) {
  assertCan(ctx, "client.manage");
  const v = clientSchema.parse(raw);
  const old = await db.client.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!old) throw new BusinessError("Client not found.");
  const c = await db.client.update({
    where: { id },
    data: {
      name: v.name,
      contactPerson: v.contactPerson ?? null,
      address: v.address ?? null,
      phone: v.phone ?? null,
      email: v.email ?? null,
      status: v.status,
      startDate: v.startDate ? d(v.startDate) : null,
      endDate: v.endDate ? d(v.endDate) : null,
    },
  });
  await logAudit(ctx, {
    action: "CLIENT_UPDATE",
    entity: "Client",
    entityId: id,
    oldValue: old,
    newValue: c,
  });
  return c;
}

export async function listClients(ctx: Ctx) {
  return db.client.findMany({
    where: { organizationId: ctx.orgId },
    orderBy: { name: "asc" },
    include: { _count: { select: { contracts: true, beats: true, employees: true } } },
  });
}

export async function getClient(ctx: Ctx, id: string) {
  return db.client.findFirst({
    where: { id, organizationId: ctx.orgId },
    include: {
      contracts: {
        include: {
          defaultStructure: true,
          rates: { include: { category: true, salaryStructure: true } },
          _count: { select: { beats: true } },
        },
      },
      beats: {
        include: { contract: true, _count: { select: { currentEmployees: true } } },
        orderBy: { name: "asc" },
      },
    },
  });
}

// ───────────────────────────── Contracts ─────────────────────────────

export const contractSchema = z.object({
  clientId: z.string().min(1, "Client is required"),
  contractNumber: opt,
  name: z.string().trim().min(2),
  startDate: z.string().min(10),
  endDate: opt,
  contractValue: z.coerce.number().min(0).optional(),
  billingMethod: z.enum(["PER_HEAD_MONTHLY", "LUMP_SUM_MONTHLY", "PER_SHIFT"]).default("PER_HEAD_MONTHLY"),
  status: z.enum(["DRAFT", "ACTIVE", "EXPIRED", "TERMINATED"]).default("ACTIVE"),
  businessLine: z.enum(["GUARDING", "OUTSOURCING"]).default("GUARDING"),
  operativeSharePct: z.coerce.number().min(1).max(100).default(70),
  defaultStructureId: opt,
  notes: opt,
});

export async function createContract(ctx: Ctx, raw: z.input<typeof contractSchema>) {
  assertCan(ctx, "client.manage");
  const v = contractSchema.parse(raw);
  const client = await db.client.findFirst({ where: { id: v.clientId, organizationId: ctx.orgId } });
  if (!client) throw new BusinessError("Client not found.");
  if (v.defaultStructureId) await assertStructure(ctx, v.defaultStructureId);
  return db.$transaction(async (tx) => {
    const contractNumber = v.contractNumber?.toUpperCase() ?? (await nextNumber(tx, ctx.orgId, "CONTRACT"));
    const c = await tx.contract.create({
      data: {
        organizationId: ctx.orgId,
        clientId: v.clientId,
        contractNumber,
        name: v.name,
        startDate: d(v.startDate),
        endDate: v.endDate ? d(v.endDate) : null,
        contractValue: v.contractValue ?? null,
        billingMethod: v.billingMethod,
        status: v.status,
        businessLine: v.businessLine,
        operativeSharePct: v.operativeSharePct,
        defaultStructureId: v.defaultStructureId ?? null,
        notes: v.notes,
      },
    });
    await logAudit(ctx, { action: "CONTRACT_CREATE", entity: "Contract", entityId: c.id, newValue: c }, tx);
    return c;
  });
}

async function assertStructure(ctx: Ctx, id: string) {
  const s = await db.salaryStructure.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!s) throw new BusinessError("Salary structure not found.");
  if (s.status !== "ACTIVE") throw new BusinessError("Only ACTIVE salary structures can be assigned.");
  return s;
}

export async function listContracts(ctx: Ctx, clientId?: string) {
  return db.contract.findMany({
    where: { organizationId: ctx.orgId, ...(clientId ? { clientId } : {}) },
    include: {
      client: true,
      defaultStructure: true,
      rates: { include: { category: true, salaryStructure: true }, orderBy: { effectiveFrom: "desc" } },
      _count: { select: { beats: true } },
    },
    orderBy: [{ client: { name: "asc" } }, { contractNumber: "asc" }],
  });
}

/**
 * Reclassifies a contract as guarding or outsourcing/resourcing. Only changes which employer
 * add-on costs (ITF, NSITF, insurance, uniform & kits, recruitment/training, leave reliever /
 * outsourcing leave allowance) future payroll runs compute for it — nothing else about the
 * contract, and never touches an already-locked payroll.
 */
export async function setContractBusinessLine(
  ctx: Ctx,
  contractId: string,
  businessLine: "GUARDING" | "OUTSOURCING",
) {
  assertCan(ctx, "client.manage");
  const old = await db.contract.findFirst({ where: { id: contractId, organizationId: ctx.orgId } });
  if (!old) throw new BusinessError("Contract not found.");
  if (old.businessLine === businessLine) return old;
  const c = await db.contract.update({ where: { id: contractId }, data: { businessLine } });
  await logAudit(ctx, {
    action: "CONTRACT_BUSINESS_LINE_CHANGE",
    entity: "Contract",
    entityId: contractId,
    oldValue: { businessLine: old.businessLine },
    newValue: { businessLine },
  });
  return c;
}

// ─────────────── Contract rates: CLIENT → CONTRACT → CATEGORY → STRUCTURE → RATE ───────────────

export const contractRateSchema = z.object({
  contractId: z.string().min(1),
  categoryId: z.string().min(1),
  salaryStructureId: z.string().min(1),
  agreedRate: z.coerce.number().positive("Agreed rate must be greater than zero"),
  operativeSharePct: z.coerce.number().min(1).max(100).optional(),
  effectiveFrom: z.string().min(10),
});

/** Adds an effective-dated agreed rate. The previous open rate for the same category is closed the day before. */
export async function addContractRate(ctx: Ctx, raw: z.input<typeof contractRateSchema>) {
  assertCan(ctx, "client.manage");
  const v = contractRateSchema.parse(raw);
  const contract = await db.contract.findFirst({ where: { id: v.contractId, organizationId: ctx.orgId } });
  if (!contract) throw new BusinessError("Contract not found.");
  const cat = await db.employeeCategory.findFirst({ where: { id: v.categoryId, organizationId: ctx.orgId } });
  if (!cat) throw new BusinessError("Category not found.");
  await assertStructure(ctx, v.salaryStructureId);
  const from = d(v.effectiveFrom);
  return db.$transaction(async (tx) => {
    const open = await tx.contractRate.findMany({
      where: {
        organizationId: ctx.orgId,
        contractId: v.contractId,
        categoryId: v.categoryId,
        effectiveTo: null,
      },
    });
    for (const r of open) {
      if (r.effectiveFrom >= from)
        throw new BusinessError("A rate for this category already starts on or after this date.");
      await tx.contractRate.update({
        where: { id: r.id },
        data: { effectiveTo: new Date(from.getTime() - 86400000) },
      });
    }
    const rate = await tx.contractRate.create({
      data: {
        organizationId: ctx.orgId,
        contractId: v.contractId,
        categoryId: v.categoryId,
        salaryStructureId: v.salaryStructureId,
        agreedRate: v.agreedRate,
        operativeSharePct: v.operativeSharePct ?? null,
        effectiveFrom: from,
      },
    });
    await logAudit(
      ctx,
      { action: "CONTRACT_RATE_SET", entity: "Contract", entityId: v.contractId, newValue: rate },
      tx,
    );
    return rate;
  });
}

// ───────────────────────────── Beats ─────────────────────────────

export const beatSchema = z.object({
  contractId: z.string().min(1, "Contract is required"),
  code: opt,
  name: z.string().trim().min(2),
  bidReference: opt,
  region: opt,
  state: opt,
  lga: opt,
  address: opt,
  siteContact: opt,
  approvedStrength: z.coerce.number().int().min(0),
  startDate: opt,
  endDate: opt,
  supervisorId: opt,
});

export async function createBeat(ctx: Ctx, raw: z.input<typeof beatSchema>) {
  assertCan(ctx, "client.manage");
  const v = beatSchema.parse(raw);
  const contract = await db.contract.findFirst({ where: { id: v.contractId, organizationId: ctx.orgId } });
  if (!contract) throw new BusinessError("Contract not found.");
  return db.$transaction(async (tx) => {
    const code = v.code?.toUpperCase() ?? (await nextNumber(tx, ctx.orgId, "BEAT"));
    const b = await tx.beat.create({
      data: {
        organizationId: ctx.orgId,
        clientId: contract.clientId,
        contractId: contract.id,
        code,
        name: v.name,
        bidReference: v.bidReference,
        region: v.region,
        state: v.state,
        lga: v.lga,
        address: v.address,
        siteContact: v.siteContact,
        approvedStrength: v.approvedStrength,
        status: "UNMAPPED", // new beats start UNMAPPED until operations map employees
        startDate: v.startDate ? d(v.startDate) : null,
        endDate: v.endDate ? d(v.endDate) : null,
        supervisorId: v.supervisorId ?? null,
      },
    });
    await logAudit(ctx, { action: "BEAT_CREATE", entity: "Beat", entityId: b.id, newValue: b }, tx);
    return b;
  });
}

export async function updateBeatStrength(
  ctx: Ctx,
  beatId: string,
  approvedStrength: number,
  reason?: string,
) {
  assertCan(ctx, "client.manage");
  const old = await db.beat.findFirst({ where: { id: beatId, organizationId: ctx.orgId } });
  if (!old) throw new BusinessError("Beat not found.");
  const b = await db.beat.update({ where: { id: beatId }, data: { approvedStrength } });
  await recomputeBeatStatus(db, ctx.orgId, beatId);
  await logAudit(ctx, {
    action: "BEAT_STRENGTH_UPDATE",
    entity: "Beat",
    entityId: beatId,
    oldValue: { approvedStrength: old.approvedStrength },
    newValue: { approvedStrength },
    reason,
  });
  return b;
}

/** UNMAPPED → MAPPED / UNDERSTAFFED / OVERSTAFFED based on active deployments. */
export async function recomputeBeatStatus(tx: Tx, orgId: string, beatId: string) {
  const beat = await tx.beat.findFirst({ where: { id: beatId, organizationId: orgId } });
  if (!beat || beat.status === "INACTIVE") return;
  const actual = await tx.deployment.count({ where: { organizationId: orgId, beatId, status: "ACTIVE" } });
  let status: "UNMAPPED" | "MAPPED" | "UNDERSTAFFED" | "OVERSTAFFED";
  if (actual === 0) status = beat.status === "UNMAPPED" ? "UNMAPPED" : "UNDERSTAFFED";
  else if (actual < beat.approvedStrength) status = "UNDERSTAFFED";
  else if (actual > beat.approvedStrength) status = "OVERSTAFFED";
  else status = "MAPPED";
  if (status !== beat.status) await tx.beat.update({ where: { id: beatId }, data: { status } });
}

export async function listBeats(
  ctx: Ctx,
  f: { clientId?: string; contractId?: string; status?: string } = {},
) {
  const beats = await db.beat.findMany({
    where: {
      organizationId: ctx.orgId,
      ...(f.clientId ? { clientId: f.clientId } : {}),
      ...(f.contractId ? { contractId: f.contractId } : {}),
      ...(f.status ? { status: f.status as "MAPPED" } : {}),
    },
    include: { client: true, contract: true, supervisor: true },
    orderBy: [{ client: { name: "asc" } }, { name: "asc" }],
  });
  const counts = await db.deployment.groupBy({
    by: ["beatId"],
    where: { organizationId: ctx.orgId, status: "ACTIVE" },
    _count: { _all: true },
  });
  const map = new Map(counts.map((c) => [c.beatId, c._count._all]));
  return beats.map((b) => {
    const actual = map.get(b.id) ?? 0;
    return {
      ...b,
      actualStrength: actual,
      vacancies: Math.max(0, b.approvedStrength - actual),
      overdeployed: Math.max(0, actual - b.approvedStrength),
    };
  });
}

// ───────────────────────── Activation dashboard ─────────────────────────

export async function activationSummary(ctx: Ctx, asOf = new Date()) {
  const start = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), 1));
  const where = { organizationId: ctx.orgId, createdAt: { gte: start } };
  const [newClients, newContracts, newBeats, beats, unassigned] = await Promise.all([
    db.client.count({ where }),
    db.contract.count({ where }),
    db.beat.count({ where }),
    listBeats(ctx),
    db.employee.findMany({
      where: { organizationId: ctx.orgId, status: "ACTIVE", deployments: { none: { status: "ACTIVE" } } },
      include: { category: true },
      orderBy: { employeeNumber: "asc" },
    }),
  ]);
  const active = beats.filter((b) => b.status !== "INACTIVE");
  return {
    newClients,
    newContracts,
    newBeats,
    newActivations: newClients + newContracts + newBeats,
    unmapped: active.filter((b) => b.actualStrength === 0),
    below: active.filter((b) => b.actualStrength > 0 && b.actualStrength < b.approvedStrength),
    above: active.filter((b) => b.actualStrength > b.approvedStrength),
    unassigned,
    beats: active,
  };
}
