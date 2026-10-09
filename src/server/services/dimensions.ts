/**
 * Accounting dimensions: the master data for regions, branches, profit centres and projects, and the report that
 * slices the ledger by any dimension.
 *
 * The other dimensions (client, contract, beat, cost centre, department, employee, asset) are masters that already
 * exist elsewhere in the system. These four are new. Every ledger line can carry any of them; the posting engine
 * checks they belong to the organization. Reports here read the ledger itself, so a figure by client or by contract
 * is the ledger's figure and reconciles to the trial balance.
 */
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { d } from "@/lib/dates";
import { DIMENSIONS, dimensionByKey, type DimensionColumn } from "@/lib/dimensions";
import { num, round2 } from "@/lib/money";
import { assertCan, BusinessError, db } from "./_base";
import { logAudit } from "./audit";

const code = z.string().trim().min(2, "Give it a short code").max(20);
const name = z.string().trim().min(2, "Give it a name").max(120);
const blank = z.string().optional().transform((v) => (v ? v : undefined));

export const regionSchema = z.object({ code, name, parentId: blank });
export const branchSchema = z.object({ code, name, regionId: blank });
export const profitCentreSchema = z.object({ code, name });
export const projectSchema = z.object({ code, name, clientId: blank, contractId: blank, startDate: blank, endDate: blank });

export type MasterKind = "REGION" | "BRANCH" | "PROFIT_CENTRE" | "PROJECT";

export async function listDimensionMasters(ctx: Ctx) {
  assertCan(ctx, "gl.view");
  const where = { organizationId: ctx.orgId };
  const [regions, branches, profitCentres, projects, clients, contracts] = await Promise.all([
    db.region.findMany({ where, orderBy: { code: "asc" }, include: { parent: { select: { code: true, name: true } } } }),
    db.branch.findMany({ where, orderBy: { code: "asc" }, include: { region: { select: { code: true, name: true } } } }),
    db.profitCentre.findMany({ where, orderBy: { code: "asc" } }),
    db.project.findMany({ where, orderBy: { code: "asc" } }),
    db.client.findMany({ where, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }),
    db.contract.findMany({ where, select: { id: true, contractNumber: true, name: true, clientId: true }, orderBy: { contractNumber: "asc" } }),
  ]);
  return { regions, branches, profitCentres, projects, clients, contracts };
}

export async function createRegion(ctx: Ctx, raw: z.input<typeof regionSchema>) {
  assertCan(ctx, "gl.manage");
  const v = regionSchema.parse(raw);
  if (v.parentId && !(await db.region.findFirst({ where: { id: v.parentId, organizationId: ctx.orgId } }))) throw new BusinessError("That parent region doesn't exist.");
  const r = await db.region.create({ data: { organizationId: ctx.orgId, ...v } });
  await logAudit(ctx, { action: "DIMENSION_CREATE", entity: "Region", entityId: r.id, newValue: r });
  return r;
}

export async function createBranch(ctx: Ctx, raw: z.input<typeof branchSchema>) {
  assertCan(ctx, "gl.manage");
  const v = branchSchema.parse(raw);
  if (v.regionId && !(await db.region.findFirst({ where: { id: v.regionId, organizationId: ctx.orgId } }))) throw new BusinessError("That region doesn't exist.");
  const b = await db.branch.create({ data: { organizationId: ctx.orgId, ...v } });
  await logAudit(ctx, { action: "DIMENSION_CREATE", entity: "Branch", entityId: b.id, newValue: b });
  return b;
}

export async function createProfitCentre(ctx: Ctx, raw: z.input<typeof profitCentreSchema>) {
  assertCan(ctx, "gl.manage");
  const v = profitCentreSchema.parse(raw);
  const p = await db.profitCentre.create({ data: { organizationId: ctx.orgId, ...v } });
  await logAudit(ctx, { action: "DIMENSION_CREATE", entity: "ProfitCentre", entityId: p.id, newValue: p });
  return p;
}

export async function createProject(ctx: Ctx, raw: z.input<typeof projectSchema>) {
  assertCan(ctx, "gl.manage");
  const v = projectSchema.parse(raw);
  const start = v.startDate ? d(v.startDate) : null;
  const end = v.endDate ? d(v.endDate) : null;
  if ((start && Number.isNaN(start.getTime())) || (end && Number.isNaN(end.getTime()))) throw new BusinessError("A project date isn't valid.");
  if (start && end && end < start) throw new BusinessError("A project can't end before it starts.");
  if (v.clientId && !(await db.client.findFirst({ where: { id: v.clientId, organizationId: ctx.orgId } }))) throw new BusinessError("That client doesn't exist.");
  if (v.contractId) {
    const c = await db.contract.findFirst({ where: { id: v.contractId, organizationId: ctx.orgId } });
    if (!c) throw new BusinessError("That contract doesn't exist.");
    if (v.clientId && c.clientId !== v.clientId) throw new BusinessError("That contract doesn't belong to the client you chose.");
  }
  const p = await db.project.create({ data: { organizationId: ctx.orgId, code: v.code, name: v.name, clientId: v.clientId, contractId: v.contractId, startDate: start, endDate: end } });
  await logAudit(ctx, { action: "DIMENSION_CREATE", entity: "Project", entityId: p.id, newValue: p });
  return p;
}

/** Retiring a dimension stops new postings using it; the lines already posted keep it. */
export async function setDimensionActive(ctx: Ctx, kind: MasterKind, id: string, active: boolean) {
  assertCan(ctx, "gl.manage");
  const where = { id, organizationId: ctx.orgId };
  const data = { active };
  const found =
    kind === "REGION" ? await db.region.updateMany({ where, data })
    : kind === "BRANCH" ? await db.branch.updateMany({ where, data })
    : kind === "PROFIT_CENTRE" ? await db.profitCentre.updateMany({ where, data })
    : await db.project.updateMany({ where, data });
  if (!found.count) throw new BusinessError("Not found.");
  await logAudit(ctx, { action: active ? "DIMENSION_ACTIVATE" : "DIMENSION_DEACTIVATE", entity: kind, entityId: id });
}

// ─────────────────────────────── The ledger, sliced ───────────────────────────────

export interface DimensionRow {
  id: string | null;
  label: string;
  income: number;
  expense: number;
  net: number;
  debit: number;
  credit: number;
  lines: number;
}

/** Display names for the ids of one dimension. */
async function labelsFor(orgId: string, column: DimensionColumn, ids: string[]): Promise<Map<string, string>> {
  const where = { organizationId: orgId, id: { in: ids } };
  const out = new Map<string, string>();
  const put = (rows: Array<{ id: string }>, f: (r: never) => string) => rows.forEach((r) => out.set(r.id, f(r as never)));
  if (!ids.length) return out;
  switch (column) {
    case "clientId": put(await db.client.findMany({ where, select: { id: true, code: true, name: true } }), (r: { code: string; name: string }) => `${r.code} — ${r.name}`); break;
    case "contractId": put(await db.contract.findMany({ where, select: { id: true, contractNumber: true, name: true } }), (r: { contractNumber: string; name: string }) => `${r.contractNumber} — ${r.name}`); break;
    case "beatId": put(await db.beat.findMany({ where, select: { id: true, code: true, name: true } }), (r: { code: string; name: string }) => `${r.code} — ${r.name}`); break;
    case "costCenterId": put(await db.costCenter.findMany({ where, select: { id: true, code: true, name: true } }), (r: { code: string; name: string }) => `${r.code} — ${r.name}`); break;
    case "departmentId": put(await db.department.findMany({ where, select: { id: true, code: true, name: true } }), (r: { code: string; name: string }) => `${r.code} — ${r.name}`); break;
    case "employeeId": put(await db.employee.findMany({ where, select: { id: true, employeeNumber: true, firstName: true, lastName: true } }), (r: { employeeNumber: string; firstName: string; lastName: string }) => `${r.employeeNumber} — ${r.firstName} ${r.lastName}`); break;
    case "fixedAssetId": put(await db.fixedAsset.findMany({ where, select: { id: true, assetNumber: true, name: true } }), (r: { assetNumber: string; name: string }) => `${r.assetNumber} — ${r.name}`); break;
    case "regionId": put(await db.region.findMany({ where, select: { id: true, code: true, name: true } }), (r: { code: string; name: string }) => `${r.code} — ${r.name}`); break;
    case "branchId": put(await db.branch.findMany({ where, select: { id: true, code: true, name: true } }), (r: { code: string; name: string }) => `${r.code} — ${r.name}`); break;
    case "profitCentreId": put(await db.profitCentre.findMany({ where, select: { id: true, code: true, name: true } }), (r: { code: string; name: string }) => `${r.code} — ${r.name}`); break;
    case "projectId": put(await db.project.findMany({ where, select: { id: true, code: true, name: true } }), (r: { code: string; name: string }) => `${r.code} — ${r.name}`); break;
  }
  return out;
}

/**
 * Income, expense and net result by one dimension, straight from the ledger, for a range of posting dates. Only income
 * and expense lines count. Lines that don't carry the dimension are shown as one "not analysed" row, so the rows always
 * add up to the whole ledger's result and the totals equal the trial balance's income and expense for the same dates.
 */
export async function ledgerByDimension(ctx: Ctx, input: { dimension: string; from?: string; to?: string }) {
  assertCan(ctx, "gl.view");
  const dim = dimensionByKey(input.dimension);
  if (!dim) throw new BusinessError(`${input.dimension} isn't an accounting dimension.`);
  const from = input.from ? d(input.from) : null;
  const to = input.to ? d(input.to) : null;
  if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) throw new BusinessError("A date isn't valid.");

  const grouped = await db.journalLine.groupBy({
    by: [dim.column, "accountId"],
    // a profit-and-loss view: only income and expense lines (the balance-sheet side of an entry isn't part of the result)
    where: { account: { type: { in: ["INCOME", "EXPENSE"] } }, journal: { organizationId: ctx.orgId, ...(from || to ? { postingDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}) } },
    _sum: { debit: true, credit: true },
    _count: { _all: true },
  });
  const accounts = await db.glAccount.findMany({ where: { organizationId: ctx.orgId, id: { in: [...new Set(grouped.map((g) => g.accountId))] } }, select: { id: true, type: true } });
  const typeOf = new Map(accounts.map((a) => [a.id, a.type]));

  const buckets = new Map<string | null, DimensionRow>();
  for (const g of grouped) {
    const id = (g as unknown as Record<string, string | null>)[dim.column] ?? null;
    const row = buckets.get(id) ?? { id, label: "", income: 0, expense: 0, net: 0, debit: 0, credit: 0, lines: 0 };
    const debit = num(g._sum.debit);
    const credit = num(g._sum.credit);
    const type = typeOf.get(g.accountId);
    if (type === "INCOME") row.income = round2(row.income + credit - debit);
    if (type === "EXPENSE") row.expense = round2(row.expense + debit - credit);
    row.debit = round2(row.debit + debit);
    row.credit = round2(row.credit + credit);
    row.lines += g._count._all;
    buckets.set(id, row);
  }
  const labels = await labelsFor(ctx.orgId, dim.column, [...buckets.keys()].filter((k): k is string => !!k));
  const rows = [...buckets.values()]
    .map((r) => ({ ...r, net: round2(r.income - r.expense), label: r.id ? (labels.get(r.id) ?? r.id) : `Not analysed by ${dim.label.toLowerCase()}` }))
    .sort((a, b) => (a.id === null ? 1 : b.id === null ? -1 : b.net - a.net));
  const totals = rows.reduce((t, r) => ({ income: round2(t.income + r.income), expense: round2(t.expense + r.expense), net: round2(t.net + r.net), debit: round2(t.debit + r.debit), credit: round2(t.credit + r.credit), lines: t.lines + r.lines }), { income: 0, expense: 0, net: 0, debit: 0, credit: 0, lines: 0 });
  return { dimension: dim.key, label: dim.label, from: input.from, to: input.to, rows, totals, dimensions: DIMENSIONS };
}
