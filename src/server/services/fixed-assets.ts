/**
 * Fixed asset register — vehicles, radios, CCTV, firearms, office/IT equipment. Depreciation is
 * straight-line and computed on the fly from (cost, salvageValue, usefulLifeMonths, acquisitionDate)
 * rather than stored as a running ledger, so there's nothing to re-run when a rate changes and no
 * risk of a stored schedule drifting from the asset's own fields.
 *
 * Depreciation counts whole calendar months only (the acquisition month counts as month 1) — day-of-
 * month is ignored, which matches how most straight-line schedules are actually run in practice.
 */
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { d, iso } from "@/lib/dates";
import { num, round2 } from "@/lib/money";
import { assertCan, BusinessError, db } from "./_base";
import { logAudit } from "./audit";
import { nextNumber } from "./numbering";

const opt = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));

export const CATEGORIES = [
  "VEHICLE",
  "RADIO_COMMS",
  "CCTV_SECURITY",
  "FIREARM",
  "OFFICE_EQUIPMENT",
  "IT_EQUIPMENT",
  "FURNITURE",
  "OTHER",
] as const;

export const fixedAssetSchema = z.object({
  name: z.string().trim().min(2, "Name is required"),
  category: z.enum(CATEGORIES),
  costCenterId: opt,
  serialNumber: opt,
  locationDescription: opt,
  assignedToEmployeeId: opt,
  acquisitionDate: z.string().min(10, "Acquisition date is required"),
  cost: z.coerce.number().positive("Cost must be greater than zero"),
  usefulLifeMonths: z.coerce.number().int().positive("Useful life must be at least 1 month"),
  salvageValue: z.coerce.number().min(0).default(0),
  notes: opt,
});

export async function createFixedAsset(ctx: Ctx, raw: z.input<typeof fixedAssetSchema>) {
  assertCan(ctx, "payment.manage");
  const v = fixedAssetSchema.parse(raw);
  if (v.salvageValue >= v.cost)
    throw new BusinessError("Salvage value must be less than the acquisition cost.");
  if (v.costCenterId) {
    const cc = await db.costCenter.findFirst({ where: { id: v.costCenterId, organizationId: ctx.orgId } });
    if (!cc) throw new BusinessError("Cost center not found.");
  }
  if (v.assignedToEmployeeId) {
    const emp = await db.employee.findFirst({
      where: { id: v.assignedToEmployeeId, organizationId: ctx.orgId },
    });
    if (!emp) throw new BusinessError("Employee not found.");
  }
  return db.$transaction(async (tx) => {
    const assetNumber = await nextNumber(tx, ctx.orgId, "FIXED_ASSET");
    const asset = await tx.fixedAsset.create({
      data: {
        organizationId: ctx.orgId,
        assetNumber,
        name: v.name,
        category: v.category,
        costCenterId: v.costCenterId ?? null,
        serialNumber: v.serialNumber ?? null,
        locationDescription: v.locationDescription ?? null,
        assignedToEmployeeId: v.assignedToEmployeeId ?? null,
        acquisitionDate: d(v.acquisitionDate),
        cost: v.cost,
        usefulLifeMonths: v.usefulLifeMonths,
        salvageValue: v.salvageValue,
        notes: v.notes ?? null,
        createdBy: ctx.name,
      },
    });
    await logAudit(
      ctx,
      { action: "FIXED_ASSET_CREATE", entity: "FixedAsset", entityId: asset.id, newValue: asset },
      tx,
    );
    return asset;
  });
}

export const disposeFixedAssetSchema = z.object({
  disposalDate: z.string().min(10, "Disposal date is required"),
  disposalProceeds: z.coerce.number().min(0).default(0),
  disposalReason: z.string().trim().min(5, "Give a reason for disposing of this asset."),
});

export async function disposeFixedAsset(ctx: Ctx, id: string, raw: z.input<typeof disposeFixedAssetSchema>) {
  assertCan(ctx, "payment.manage");
  const v = disposeFixedAssetSchema.parse(raw);
  const asset = await db.fixedAsset.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!asset) throw new BusinessError("Fixed asset not found.");
  if (asset.status === "DISPOSED") throw new BusinessError("This asset has already been disposed of.");
  if (d(v.disposalDate) < asset.acquisitionDate)
    throw new BusinessError("Disposal date can't be before the acquisition date.");
  const updated = await db.fixedAsset.update({
    where: { id },
    data: {
      status: "DISPOSED",
      disposalDate: d(v.disposalDate),
      disposalProceeds: v.disposalProceeds,
      disposalReason: v.disposalReason,
    },
  });
  await logAudit(ctx, {
    action: "FIXED_ASSET_DISPOSE",
    entity: "FixedAsset",
    entityId: id,
    reason: v.disposalReason,
    newValue: { disposalDate: v.disposalDate, disposalProceeds: v.disposalProceeds },
  });
  return updated;
}

/** Whole calendar months elapsed from `from` to `to`, with the starting month counting as month 1. */
function monthsElapsed(from: Date, to: Date): number {
  if (to < from) return 0;
  return (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth()) + 1;
}

export function monthlyDepreciation(asset: { cost: unknown; salvageValue: unknown; usefulLifeMonths: number }) {
  const base = num(asset.cost) - num(asset.salvageValue);
  return asset.usefulLifeMonths > 0 ? round2(base / asset.usefulLifeMonths) : 0;
}

/** Accumulated depreciation as of a date — frozen at the disposal date once an asset is disposed. */
export function accumulatedDepreciation(
  asset: {
    cost: unknown;
    salvageValue: unknown;
    usefulLifeMonths: number;
    acquisitionDate: Date;
    status: string;
    disposalDate: Date | null;
  },
  asOf: Date,
) {
  const effectiveAsOf = asset.status === "DISPOSED" && asset.disposalDate && asset.disposalDate < asOf
    ? asset.disposalDate
    : asOf;
  const months = Math.min(monthsElapsed(asset.acquisitionDate, effectiveAsOf), asset.usefulLifeMonths);
  return round2(monthlyDepreciation(asset) * months);
}

export function netBookValue(
  asset: {
    cost: unknown;
    salvageValue: unknown;
    usefulLifeMonths: number;
    acquisitionDate: Date;
    status: string;
    disposalDate: Date | null;
  },
  asOf: Date,
) {
  return round2(num(asset.cost) - accumulatedDepreciation(asset, asOf));
}

export async function listFixedAssets(
  ctx: Ctx,
  filter: { category?: string; status?: string; costCenterId?: string } = {},
) {
  return db.fixedAsset.findMany({
    where: {
      organizationId: ctx.orgId,
      ...(filter.category ? { category: filter.category as never } : {}),
      ...(filter.status ? { status: filter.status as never } : {}),
      ...(filter.costCenterId ? { costCenterId: filter.costCenterId } : {}),
    },
    include: { costCenter: true, assignedToEmployee: true },
    orderBy: [{ status: "asc" }, { acquisitionDate: "desc" }],
  });
}

export async function getFixedAsset(ctx: Ctx, id: string) {
  return db.fixedAsset.findFirst({
    where: { id, organizationId: ctx.orgId },
    include: { costCenter: true, assignedToEmployee: true },
  });
}

/** The register report: every asset with its computed depreciation as of a date, plus totals. */
export async function assetRegister(ctx: Ctx, asOf?: string) {
  assertCan(ctx, "gl.view");
  const cutoff = d(asOf && asOf.length >= 10 ? asOf : iso(new Date()));
  const assets = await listFixedAssets(ctx);
  const rows = assets.map((a) => ({
    ...a,
    monthlyDepreciation: monthlyDepreciation(a),
    accumulatedDepreciation: accumulatedDepreciation(a, cutoff),
    netBookValue: netBookValue(a, cutoff),
  }));
  const active = rows.filter((r) => r.status === "ACTIVE");
  const totals = {
    cost: round2(active.reduce((s, r) => s + num(r.cost), 0)),
    accumulatedDepreciation: round2(active.reduce((s, r) => s + r.accumulatedDepreciation, 0)),
    netBookValue: round2(active.reduce((s, r) => s + r.netBookValue, 0)),
  };
  const byCategory = new Map<string, { cost: number; accumulatedDepreciation: number; netBookValue: number; count: number }>();
  for (const r of active) {
    const row = byCategory.get(r.category) ?? {
      cost: 0,
      accumulatedDepreciation: 0,
      netBookValue: 0,
      count: 0,
    };
    row.cost = round2(row.cost + num(r.cost));
    row.accumulatedDepreciation = round2(row.accumulatedDepreciation + r.accumulatedDepreciation);
    row.netBookValue = round2(row.netBookValue + r.netBookValue);
    row.count += 1;
    byCategory.set(r.category, row);
  }
  return {
    asOf: iso(cutoff),
    rows,
    totals,
    byCategory: [...byCategory.entries()].map(([category, v]) => ({ category, ...v })),
  };
}
