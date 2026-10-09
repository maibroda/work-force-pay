"use server";
import { act } from "./_run";
import * as gl from "@/server/services/accounting";
import { DIMENSION_KEYS } from "@/lib/dimensions";

type V = Record<string, unknown>;

const PATHS = ["/accounting", "/payroll"];

/** The form has one tick box per dimension (dim_CLIENT …); the ticked ones are the required list. Undefined when the form had none. */
const requiredFrom = (v: V) => (DIMENSION_KEYS.some((k) => `dim_${k}` in v) ? DIMENSION_KEYS.filter((k) => v[`dim_${k}`] === true) : undefined);

export async function createAccountAction(v: V) {
  return act(
    "gl.manage",
    async (ctx) => {
      const a = await gl.createAccount(ctx, { ...v, requiredDimensions: requiredFrom(v) } as never);
      return { message: `Account ${a.code} — ${a.name} created.` };
    },
    PATHS,
  );
}

export async function setAccountActiveAction(id: string, active: boolean) {
  return act(
    "gl.manage",
    async (ctx) => {
      await gl.updateAccount(ctx, id, { active });
      return { message: active ? "Account activated." : "Account deactivated." };
    },
    PATHS,
  );
}

/** Edits where an account sits and how it reports: category, parent, dates, statement line, tax mapping. */
export async function updateAccountAction(id: string, v: V) {
  return act(
    "gl.manage",
    async (ctx) => {
      const blank = (x: unknown) => (x === undefined || x === "" ? null : String(x));
      const a = await gl.updateAccount(ctx, id, {
        name: v.name ? String(v.name) : undefined,
        description: v.description === undefined ? undefined : blank(v.description),
        categoryId: v.categoryId === undefined ? undefined : blank(v.categoryId),
        parentId: v.parentId === undefined ? undefined : blank(v.parentId),
        effectiveFrom: v.effectiveFrom === undefined ? undefined : blank(v.effectiveFrom),
        effectiveTo: v.effectiveTo === undefined ? undefined : blank(v.effectiveTo),
        statementLine: v.statementLine === undefined ? undefined : blank(v.statementLine),
        taxMapping: v.taxMapping === undefined ? undefined : blank(v.taxMapping),
        requiredDimensions: requiredFrom(v),
      });
      return { message: `Account ${a.code} updated.` };
    },
    PATHS,
  );
}

export async function createGroupAction(v: V) {
  return act(
    "gl.manage",
    async (ctx) => {
      const g = await gl.createGroup(ctx, v as never);
      return { message: `Group ${g.code} — ${g.name} created.` };
    },
    PATHS,
  );
}

export async function createCategoryAction(v: V) {
  return act(
    "gl.manage",
    async (ctx) => {
      const c = await gl.createCategory(ctx, v as never);
      return { message: `Category ${c.code} — ${c.name} created.` };
    },
    PATHS,
  );
}

export async function installStandardChartAction() {
  return act(
    "gl.manage",
    async (ctx) => {
      const r = await gl.installStandardChart(ctx);
      return { message: `Standard chart installed: ${r.created} account(s) added, ${r.classified} existing account(s) placed in a category, ${r.groups} group(s) and ${r.categories} categor${r.categories === 1 ? "y" : "ies"} created. ${r.skipped ? ` ${r.skipped} existing account(s) use a standard code for a different kind of account and were left alone.` : ""} Nothing already set up was changed.` };
    },
    PATHS,
  );
}

export async function saveMappingAction(v: V) {
  return act(
    "gl.manage",
    async (ctx) => {
      const m = await gl.saveMapping(ctx, v as never);
      return { message: `${m.headCode} will post to the selected accounts from the next payroll lock.` };
    },
    PATHS,
  );
}

export async function postRunToGlAction(runId: string) {
  return act(
    "gl.manage",
    async (ctx) => {
      const j = await gl.postRunManually(ctx, runId);
      return { message: `Posted as journal ${j.entryNumber}.`, redirectTo: `/accounting/journals/${j.id}` };
    },
    PATHS,
  );
}

export async function closePeriodAction(periodId: string) {
  return act(
    "payroll.lock",
    async (ctx) => {
      const p = await gl.closePeriod(ctx, periodId);
      return { message: `${p.name} closed — payroll heads are posted to the general ledger.` };
    },
    PATHS,
  );
}
