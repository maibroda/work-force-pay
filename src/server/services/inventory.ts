/**
 * Uniform & kit stock. Every unit that comes in, goes out to an employee, comes back, or is adjusted
 * is a StockMovement — the ledger is the record of truth, and each item's quantityOnHand and
 * weighted-average cost are kept in step with it inside the same transaction.
 *
 * Rules: stock can never go negative; kit can only be issued to someone still employed; a return can
 * never exceed what that employee actually holds; only kit returned in GOOD condition goes back on the
 * shelf (damaged or lost kit is written off); every adjustment, write-off and bad return needs a reason.
 * Kit still held when someone leaves is surfaced on the exit page and can be added to their
 * end-of-service settlement as a recovery.
 */
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { d } from "@/lib/dates";
import { num, round2 } from "@/lib/money";
import { assertCan, BusinessError, db, type Tx } from "./_base";
import { logAudit } from "./audit";
import { todayUtc } from "./hr-policy";
import { nextNumber } from "./numbering";

const GONE = ["EXITED", "TERMINATED", "RESIGNED"];
const CATEGORIES = ["UNIFORM", "FOOTWEAR", "ACCESSORY", "EQUIPMENT", "OTHER"] as const;

const opt = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));
const qty = z.coerce.number().int("Quantity must be a whole number").min(1, "Quantity must be at least 1");

type Movement = {
  type: "RECEIPT" | "ISSUE" | "RETURN" | "ADJUSTMENT" | "WRITE_OFF";
  quantity: number;
  stockDelta: number;
  unitCost: number;
  condition?: "GOOD" | "DAMAGED" | "LOST";
  employeeId?: string;
  reference?: string;
  reason?: string;
  date?: Date;
};

/** Applies one movement to an item and its ledger. Refuses to take stock below zero. */
async function applyMovement(ctx: Ctx, tx: Tx, itemId: string, m: Movement, newAverageCost?: number) {
  if (m.stockDelta < 0) {
    const res = await tx.inventoryItem.updateMany({
      where: { id: itemId, organizationId: ctx.orgId, quantityOnHand: { gte: -m.stockDelta } },
      data: { quantityOnHand: { increment: m.stockDelta } },
    });
    if (!res.count) {
      const item = await tx.inventoryItem.findFirstOrThrow({ where: { id: itemId, organizationId: ctx.orgId } });
      throw new BusinessError(`Only ${item.quantityOnHand} of ${itemLabel(item)} in stock — can't take out ${-m.stockDelta}.`);
    }
  } else if (m.stockDelta > 0 || newAverageCost !== undefined) {
    await tx.inventoryItem.update({
      where: { id: itemId },
      data: {
        quantityOnHand: { increment: m.stockDelta },
        ...(newAverageCost !== undefined ? { averageCost: newAverageCost } : {}),
      },
    });
  }
  const after = await tx.inventoryItem.findFirstOrThrow({ where: { id: itemId, organizationId: ctx.orgId } });
  return tx.stockMovement.create({
    data: {
      organizationId: ctx.orgId,
      itemId,
      type: m.type,
      quantity: m.quantity,
      stockDelta: m.stockDelta,
      unitCost: m.unitCost,
      condition: m.condition ?? null,
      employeeId: m.employeeId ?? null,
      reference: m.reference ?? null,
      reason: m.reason ?? null,
      balanceAfter: after.quantityOnHand,
      movementDate: m.date ?? todayUtc(),
      createdBy: ctx.name,
    },
  });
}

const itemLabel = (i: { name: string; size: string | null }) => (i.size ? `${i.name} — ${i.size}` : i.name);

async function loadItem(ctx: Ctx, tx: Tx, id: string) {
  const item = await tx.inventoryItem.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!item) throw new BusinessError("Stock item not found.");
  return item;
}

// ───────────────────────────── Items ─────────────────────────────

export const itemSchema = z.object({
  name: z.string().trim().min(2, "Name is required"),
  category: z.enum(CATEGORIES).default("UNIFORM"),
  size: opt,
  unit: z.string().trim().min(1).default("pcs"),
  reorderLevel: z.coerce.number().int().min(0).default(0),
  notes: opt,
  openingQuantity: z.coerce.number().int().min(0).optional(),
  openingUnitCost: z.coerce.number().min(0).optional(),
});

export async function createItem(ctx: Ctx, raw: z.input<typeof itemSchema>) {
  assertCan(ctx, "inventory.manage");
  const v = itemSchema.parse(raw);
  if (v.openingQuantity && v.openingUnitCost === undefined)
    throw new BusinessError("Give the unit cost of the opening stock.");
  const dup = await db.inventoryItem.findFirst({
    where: {
      organizationId: ctx.orgId,
      name: { equals: v.name, mode: "insensitive" },
      size: v.size ? { equals: v.size, mode: "insensitive" } : null,
    },
  });
  if (dup) throw new BusinessError(`${itemLabel(dup)} is already in the stock list (${dup.sku}).`);
  return db.$transaction(async (tx) => {
    const sku = await nextNumber(tx, ctx.orgId, "INVENTORY_ITEM");
    const item = await tx.inventoryItem.create({
      data: {
        organizationId: ctx.orgId,
        sku,
        name: v.name,
        category: v.category,
        size: v.size ?? null,
        unit: v.unit,
        reorderLevel: v.reorderLevel,
        notes: v.notes ?? null,
      },
    });
    if (v.openingQuantity) {
      await applyMovement(
        ctx,
        tx,
        item.id,
        { type: "RECEIPT", quantity: v.openingQuantity, stockDelta: v.openingQuantity, unitCost: v.openingUnitCost!, reason: "Opening stock" },
        round2(v.openingUnitCost!),
      );
    }
    await logAudit(ctx, { action: "INVENTORY_ITEM_CREATE", entity: "InventoryItem", entityId: item.id, newValue: item }, tx);
    return tx.inventoryItem.findFirstOrThrow({ where: { id: item.id } });
  });
}

export const itemUpdateSchema = z.object({
  name: z.string().trim().min(2).optional(),
  category: z.enum(CATEGORIES).optional(),
  reorderLevel: z.coerce.number().int().min(0).optional(),
  active: z.boolean().optional(),
  notes: opt,
});

export async function updateItem(ctx: Ctx, id: string, raw: z.input<typeof itemUpdateSchema>) {
  assertCan(ctx, "inventory.manage");
  const v = itemUpdateSchema.parse(raw);
  const old = await loadItem(ctx, db, id);
  const item = await db.inventoryItem.update({
    where: { id },
    data: {
      ...(v.name !== undefined ? { name: v.name } : {}),
      ...(v.category !== undefined ? { category: v.category } : {}),
      ...(v.reorderLevel !== undefined ? { reorderLevel: v.reorderLevel } : {}),
      ...(v.active !== undefined ? { active: v.active } : {}),
      ...(v.notes !== undefined ? { notes: v.notes } : {}),
    },
  });
  await logAudit(ctx, { action: "INVENTORY_ITEM_UPDATE", entity: "InventoryItem", entityId: id, oldValue: old, newValue: item });
  return item;
}

// ───────────────────────────── Stock in / out ─────────────────────────────

export const receiveSchema = z.object({
  itemId: z.string().min(1),
  quantity: qty,
  unitCost: z.coerce.number().min(0, "Unit cost can't be negative"),
  reference: opt,
  movementDate: opt,
});

/** Goods in. The item's average cost becomes the weighted average of what's on the shelf and what arrived. */
export async function receiveStock(ctx: Ctx, raw: z.input<typeof receiveSchema>) {
  assertCan(ctx, "inventory.manage");
  const v = receiveSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const item = await loadItem(ctx, tx, v.itemId);
    const onHand = item.quantityOnHand;
    const avg = round2((onHand * num(item.averageCost) + v.quantity * v.unitCost) / (onHand + v.quantity));
    const m = await applyMovement(
      ctx,
      tx,
      item.id,
      {
        type: "RECEIPT",
        quantity: v.quantity,
        stockDelta: v.quantity,
        unitCost: v.unitCost,
        reference: v.reference,
        date: v.movementDate ? d(v.movementDate) : undefined,
      },
      avg,
    );
    await logAudit(ctx, { action: "STOCK_RECEIVE", entity: "InventoryItem", entityId: item.id, newValue: { quantity: v.quantity, unitCost: v.unitCost, reference: v.reference } }, tx);
    return m;
  });
}

export const adjustSchema = z.object({
  itemId: z.string().min(1),
  countedQuantity: z.coerce.number().int().min(0, "The count can't be negative"),
  reason: z.string().trim().min(3, "Give a reason (e.g. stocktake 30 Sep)"),
});

/** Stocktake: set the shelf to what was actually counted. The difference is recorded, never silent. */
export async function adjustStock(ctx: Ctx, raw: z.input<typeof adjustSchema>) {
  assertCan(ctx, "inventory.manage");
  const v = adjustSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const item = await loadItem(ctx, tx, v.itemId);
    const delta = v.countedQuantity - item.quantityOnHand;
    if (delta === 0) throw new BusinessError("The count matches the system — nothing to adjust.");
    const m = await applyMovement(ctx, tx, item.id, {
      type: "ADJUSTMENT",
      quantity: Math.abs(delta),
      stockDelta: delta,
      unitCost: num(item.averageCost),
      reason: v.reason,
    });
    await logAudit(ctx, { action: "STOCK_ADJUST", entity: "InventoryItem", entityId: item.id, oldValue: { onHand: item.quantityOnHand }, newValue: { onHand: v.countedQuantity }, reason: v.reason }, tx);
    return m;
  });
}

export const writeOffSchema = z.object({
  itemId: z.string().min(1),
  quantity: qty,
  reason: z.string().trim().min(3, "Say why (damaged, expired, stolen…)"),
});

export async function writeOffStock(ctx: Ctx, raw: z.input<typeof writeOffSchema>) {
  assertCan(ctx, "inventory.manage");
  const v = writeOffSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const item = await loadItem(ctx, tx, v.itemId);
    const m = await applyMovement(ctx, tx, item.id, {
      type: "WRITE_OFF",
      quantity: v.quantity,
      stockDelta: -v.quantity,
      unitCost: num(item.averageCost),
      reason: v.reason,
    });
    await logAudit(ctx, { action: "STOCK_WRITE_OFF", entity: "InventoryItem", entityId: item.id, newValue: { quantity: v.quantity }, reason: v.reason }, tx);
    return m;
  });
}

// ───────────────────────────── Issue & return ─────────────────────────────

async function loadEmployee(ctx: Ctx, tx: Tx, id: string) {
  const e = await tx.employee.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!e) throw new BusinessError("Employee not found.");
  return e;
}

export const issueSchema = z.object({
  employeeId: z.string().min(1),
  itemId: z.string().min(1),
  quantity: qty,
  reference: opt,
});

export async function issueKit(ctx: Ctx, raw: z.input<typeof issueSchema>) {
  assertCan(ctx, "inventory.manage");
  const v = issueSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const emp = await loadEmployee(ctx, tx, v.employeeId);
    if (GONE.includes(emp.status)) throw new BusinessError(`${emp.employeeNumber} has already left — kit can't be issued to them.`);
    const item = await loadItem(ctx, tx, v.itemId);
    if (!item.active) throw new BusinessError(`${itemLabel(item)} is switched off and can't be issued.`);
    const m = await applyMovement(ctx, tx, item.id, {
      type: "ISSUE",
      quantity: v.quantity,
      stockDelta: -v.quantity,
      unitCost: num(item.averageCost),
      employeeId: emp.id,
      reference: v.reference,
    });
    await logAudit(ctx, { action: "KIT_ISSUE", entity: "Employee", entityId: emp.id, newValue: { item: itemLabel(item), sku: item.sku, quantity: v.quantity } }, tx);
    return m;
  });
}

/** Issues every line of a kit pack in one go — all of it, or none if anything is short. */
export async function issuePack(ctx: Ctx, employeeId: string, packId: string) {
  assertCan(ctx, "inventory.manage");
  return db.$transaction(async (tx) => {
    const emp = await loadEmployee(ctx, tx, employeeId);
    if (GONE.includes(emp.status)) throw new BusinessError(`${emp.employeeNumber} has already left — kit can't be issued to them.`);
    const pack = await tx.kitPack.findFirst({ where: { id: packId, organizationId: ctx.orgId }, include: { lines: { include: { item: true } } } });
    if (!pack) throw new BusinessError("Kit pack not found.");
    if (!pack.active) throw new BusinessError(`${pack.name} is switched off.`);
    if (!pack.lines.length) throw new BusinessError(`${pack.name} has no items yet.`);
    const problems = pack.lines.flatMap((l) =>
      !l.item.active
        ? [`${itemLabel(l.item)} is switched off`]
        : l.item.quantityOnHand < l.quantity
          ? [`${itemLabel(l.item)}: need ${l.quantity}, have ${l.item.quantityOnHand}`]
          : [],
    );
    if (problems.length) throw new BusinessError(`Can't issue ${pack.name} — ${problems.join("; ")}.`);
    for (const l of pack.lines)
      await applyMovement(ctx, tx, l.itemId, {
        type: "ISSUE",
        quantity: l.quantity,
        stockDelta: -l.quantity,
        unitCost: num(l.item.averageCost),
        employeeId: emp.id,
        reference: pack.name,
      });
    await logAudit(ctx, { action: "KIT_PACK_ISSUE", entity: "Employee", entityId: emp.id, newValue: { pack: pack.name, items: pack.lines.length } }, tx);
    return { pack, issued: pack.lines.length };
  });
}

export const returnSchema = z.object({
  employeeId: z.string().min(1),
  itemId: z.string().min(1),
  quantity: qty,
  condition: z.enum(["GOOD", "DAMAGED", "LOST"]).default("GOOD"),
  reason: opt,
});

async function heldBy(tx: Tx, orgId: string, employeeId: string, itemId: string) {
  const rows = await tx.stockMovement.findMany({
    where: { organizationId: orgId, employeeId, itemId, type: { in: ["ISSUE", "RETURN"] } },
    select: { type: true, quantity: true },
  });
  return rows.reduce((s, r) => s + (r.type === "ISSUE" ? r.quantity : -r.quantity), 0);
}

/** Takes kit back from an employee (also allowed after they've left). Only GOOD kit is restocked. */
export async function returnKit(ctx: Ctx, raw: z.input<typeof returnSchema>) {
  assertCan(ctx, "inventory.manage");
  const v = returnSchema.parse(raw);
  if (v.condition !== "GOOD" && (!v.reason || v.reason.length < 3))
    throw new BusinessError(`Say what happened to the ${v.condition === "LOST" ? "lost" : "damaged"} kit.`);
  return db.$transaction(async (tx) => {
    const emp = await loadEmployee(ctx, tx, v.employeeId);
    const item = await loadItem(ctx, tx, v.itemId);
    const held = await heldBy(tx, ctx.orgId, emp.id, item.id);
    if (v.quantity > held)
      throw new BusinessError(`${emp.employeeNumber} holds ${held} of ${itemLabel(item)} — can't take back ${v.quantity}.`);
    const m = await applyMovement(ctx, tx, item.id, {
      type: "RETURN",
      quantity: v.quantity,
      stockDelta: v.condition === "GOOD" ? v.quantity : 0,
      unitCost: num(item.averageCost),
      condition: v.condition,
      employeeId: emp.id,
      reason: v.reason,
    });
    await logAudit(ctx, { action: "KIT_RETURN", entity: "Employee", entityId: emp.id, newValue: { item: itemLabel(item), quantity: v.quantity, condition: v.condition }, reason: v.reason }, tx);
    return m;
  });
}

// ───────────────────────────── What people hold ─────────────────────────────

export interface HeldRow {
  employee: { id: string; employeeNumber: string; firstName: string; lastName: string; status: string };
  item: { id: string; sku: string; name: string; size: string | null };
  issued: number;
  returned: number;
  outstanding: number;
  unitCost: number;
  value: number;
}

async function heldRows(orgId: string, employeeId?: string): Promise<HeldRow[]> {
  const moves = await db.stockMovement.findMany({
    where: { organizationId: orgId, employeeId: employeeId ?? { not: null }, type: { in: ["ISSUE", "RETURN"] } },
    include: { item: true, employee: true },
    orderBy: { createdAt: "asc" },
  });
  const rows = new Map<string, HeldRow & { issuedValue: number }>();
  for (const m of moves) {
    const key = `${m.employeeId}|${m.itemId}`;
    const r =
      rows.get(key) ??
      ({
        employee: m.employee!,
        item: m.item,
        issued: 0,
        returned: 0,
        outstanding: 0,
        unitCost: 0,
        value: 0,
        issuedValue: 0,
      } as HeldRow & { issuedValue: number });
    if (m.type === "ISSUE") {
      r.issued += m.quantity;
      r.issuedValue += m.quantity * num(m.unitCost);
    } else r.returned += m.quantity;
    rows.set(key, r);
  }
  return [...rows.values()]
    .map((r) => {
      const unitCost = r.issued ? round2(r.issuedValue / r.issued) : 0;
      const outstanding = r.issued - r.returned;
      return { employee: r.employee, item: r.item, issued: r.issued, returned: r.returned, outstanding, unitCost, value: round2(outstanding * unitCost) };
    })
    .filter((r) => r.outstanding > 0)
    .sort((a, b) => a.employee.employeeNumber.localeCompare(b.employee.employeeNumber) || a.item.name.localeCompare(b.item.name));
}

/** Kit currently held — for one employee, or everyone (leavers first). */
export async function outstandingKit(ctx: Ctx, employeeId?: string) {
  assertCan(ctx, "inventory.view");
  const rows = await heldRows(ctx.orgId, employeeId);
  if (employeeId) return rows;
  return rows.sort((a, b) => Number(GONE.includes(b.employee.status)) - Number(GONE.includes(a.employee.status)));
}

/** Total value of kit an employee still holds — used to propose a recovery on their settlement. */
export async function outstandingKitValue(orgId: string, employeeId: string) {
  const rows = await heldRows(orgId, employeeId);
  return {
    items: rows.reduce((s, r) => s + r.outstanding, 0),
    value: round2(rows.reduce((s, r) => s + r.value, 0)),
    rows,
  };
}

// ───────────────────────────── Queries ─────────────────────────────

export async function listItems(
  ctx: Ctx,
  f: { q?: string; category?: string; lowOnly?: boolean; includeInactive?: boolean } = {},
) {
  assertCan(ctx, "inventory.view");
  const items = await db.inventoryItem.findMany({
    where: {
      organizationId: ctx.orgId,
      ...(f.includeInactive ? {} : { active: true }),
      ...(f.category ? { category: f.category as never } : {}),
      ...(f.q
        ? {
            OR: [
              { name: { contains: f.q, mode: "insensitive" } },
              { sku: { contains: f.q, mode: "insensitive" } },
              { size: { contains: f.q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: [{ category: "asc" }, { name: "asc" }, { size: "asc" }],
  });
  const rows = items.map((i) => ({
    ...i,
    value: round2(i.quantityOnHand * num(i.averageCost)),
    low: i.reorderLevel > 0 && i.quantityOnHand <= i.reorderLevel,
  }));
  return f.lowOnly ? rows.filter((r) => r.low) : rows;
}

export async function getItem(ctx: Ctx, id: string) {
  assertCan(ctx, "inventory.view");
  const item = await db.inventoryItem.findFirst({
    where: { id, organizationId: ctx.orgId },
    include: { movements: { include: { employee: true }, orderBy: [{ createdAt: "desc" }], take: 200 } },
  });
  if (!item) return null;
  return { ...item, value: round2(item.quantityOnHand * num(item.averageCost)), low: item.reorderLevel > 0 && item.quantityOnHand <= item.reorderLevel };
}

export async function inventorySummary(ctx: Ctx) {
  assertCan(ctx, "inventory.view");
  const [items, held] = await Promise.all([db.inventoryItem.findMany({ where: { organizationId: ctx.orgId, active: true } }), heldRows(ctx.orgId)]);
  const leaversHolding = new Set(held.filter((h) => GONE.includes(h.employee.status)).map((h) => h.employee.id));
  return {
    itemCount: items.length,
    stockValue: round2(items.reduce((s, i) => s + i.quantityOnHand * num(i.averageCost), 0)),
    lowStock: items.filter((i) => i.reorderLevel > 0 && i.quantityOnHand <= i.reorderLevel).length,
    heldValue: round2(held.reduce((s, h) => s + h.value, 0)),
    holders: new Set(held.map((h) => h.employee.id)).size,
    leaversHolding: leaversHolding.size,
  };
}

// ───────────────────────────── Kit packs ─────────────────────────────

export const packSchema = z.object({
  name: z.string().trim().min(2, "Name is required"),
  description: opt,
  categoryId: opt,
});

export async function createPack(ctx: Ctx, raw: z.input<typeof packSchema>) {
  assertCan(ctx, "inventory.manage");
  const v = packSchema.parse(raw);
  if (v.categoryId && !(await db.employeeCategory.findFirst({ where: { id: v.categoryId, organizationId: ctx.orgId } })))
    throw new BusinessError("Employee category not found.");
  const dup = await db.kitPack.findFirst({ where: { organizationId: ctx.orgId, name: { equals: v.name, mode: "insensitive" } } });
  if (dup) throw new BusinessError(`A kit pack called "${dup.name}" already exists.`);
  const pack = await db.kitPack.create({
    data: { organizationId: ctx.orgId, name: v.name, description: v.description ?? null, categoryId: v.categoryId ?? null },
  });
  await logAudit(ctx, { action: "KIT_PACK_CREATE", entity: "KitPack", entityId: pack.id, newValue: pack });
  return pack;
}

export const packLineSchema = z.object({ itemId: z.string().min(1), quantity: qty });

/** Adds an item to a pack, or changes its quantity if it's already there. */
export async function setPackLine(ctx: Ctx, packId: string, raw: z.input<typeof packLineSchema>) {
  assertCan(ctx, "inventory.manage");
  const v = packLineSchema.parse(raw);
  const pack = await db.kitPack.findFirst({ where: { id: packId, organizationId: ctx.orgId } });
  if (!pack) throw new BusinessError("Kit pack not found.");
  await loadItem(ctx, db, v.itemId);
  const line = await db.kitPackLine.upsert({
    where: { packId_itemId: { packId, itemId: v.itemId } },
    create: { organizationId: ctx.orgId, packId, itemId: v.itemId, quantity: v.quantity },
    update: { quantity: v.quantity },
  });
  await logAudit(ctx, { action: "KIT_PACK_LINE_SET", entity: "KitPack", entityId: packId, newValue: line });
  return line;
}

export async function removePackLine(ctx: Ctx, lineId: string) {
  assertCan(ctx, "inventory.manage");
  const line = await db.kitPackLine.findFirst({ where: { id: lineId, organizationId: ctx.orgId } });
  if (!line) throw new BusinessError("Pack line not found.");
  await db.kitPackLine.delete({ where: { id: lineId } });
  await logAudit(ctx, { action: "KIT_PACK_LINE_REMOVE", entity: "KitPack", entityId: line.packId, oldValue: line });
}

export async function setPackActive(ctx: Ctx, id: string, active: boolean) {
  assertCan(ctx, "inventory.manage");
  const pack = await db.kitPack.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!pack) throw new BusinessError("Kit pack not found.");
  return db.kitPack.update({ where: { id }, data: { active } });
}

/** Packs with how many complete sets the shelf can supply right now. */
export async function listPacks(ctx: Ctx) {
  assertCan(ctx, "inventory.view");
  const packs = await db.kitPack.findMany({
    where: { organizationId: ctx.orgId },
    include: { category: true, lines: { include: { item: true }, orderBy: { item: { name: "asc" } } } },
    orderBy: { name: "asc" },
  });
  return packs.map((p) => ({
    ...p,
    setsAvailable: p.lines.length ? Math.min(...p.lines.map((l) => Math.floor(l.item.quantityOnHand / l.quantity))) : 0,
    unitValue: round2(p.lines.reduce((s, l) => s + l.quantity * num(l.item.averageCost), 0)),
  }));
}


/** Kit still held by people who have left, one row per leaver — for reminders (no permission check). */
export async function kitHeldByLeavers(orgId: string) {
  const rows = (await heldRows(orgId)).filter((r) => GONE.includes(r.employee.status));
  const byEmployee = new Map<string, { employee: HeldRow["employee"]; items: number; value: number }>();
  for (const r of rows) {
    const e = byEmployee.get(r.employee.id) ?? { employee: r.employee, items: 0, value: 0 };
    e.items += r.outstanding;
    e.value = round2(e.value + r.value);
    byEmployee.set(r.employee.id, e);
  }
  return [...byEmployee.values()];
}
