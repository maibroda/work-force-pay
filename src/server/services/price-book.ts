/**
 * The software price book (step E4b of docs/plans/module-entitlements-e4.md): what each module costs per month, as dated versions, and a quote for a prospect from the version in
 * force. **No amount is in code**: every price is entered by platform staff through the screen. A version needs a second person to verify it, and once verified it can never be
 * changed or deleted (the database refuses): a price change is a new version from a later date. A quote only ever uses a verified version, and shows no total while any module in it
 * has no price. The app records and calculates prices; it never charges anyone.
 */
import type { Ctx } from "@/lib/auth/context";
import { can, ForbiddenError } from "@/lib/auth/permissions";
import { MODULES, MODULE_KEYS, type ModuleKey } from "@/lib/entitlements/catalogue";
import { configureClient, type Answers, type Configured } from "@/lib/entitlements/configure";
import { priceBlueprint, type PriceBasis, type PriceBookData, type Quote } from "@/lib/entitlements/pricing";
import { koboToString, MoneyError, toKobo } from "@/lib/money-exact";
import { CURRENCY_CODES } from "@/lib/money";
import { BusinessError, db } from "./_base";
import { logAudit } from "./audit";

export interface PriceBookDraft {
  /** The day the version starts (YYYY-MM-DD). */
  effectiveFrom: string;
  currency?: string;
  /** Naira and kobo as text; "0.00" for no minimum. */
  minimumMonthly: string;
  note?: string;
  /** Module key to naira-and-kobo text: per employee, per CRM user or flat, by how the catalogue charges that module. An empty set is allowed (nothing priced yet). */
  lines: Record<string, string>;
}

/** Platform staff only: `pricebook.manage` is held by SUPER_ADMIN alone (withheld from COMPANY_ADMIN, which otherwise holds every permission). */
function assertKeeper(ctx: Ctx) {
  if (!can(ctx.role, "pricebook.manage")) throw new ForbiddenError("pricebook.manage");
}

/** The organization quoting: platform staff, or someone with `blueprint.manage` whose organization (their bureau, when they are working in a client) is a bureau. */
async function assertSeller(ctx: Ctx) {
  if (ctx.role === "SUPER_ADMIN") return;
  if (!can(ctx.role, "blueprint.manage")) throw new ForbiddenError("blueprint.manage");
  const org = await db.organization.findUnique({ where: { id: ctx.homeOrgId ?? ctx.orgId }, select: { isBureau: true } });
  if (!org?.isBureau) throw new ForbiddenError("blueprint.manage");
}

const dateOnly = (iso: string): Date => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || Number.isNaN(new Date(`${iso}T00:00:00Z`).getTime())) throw new BusinessError("Give the start date as YYYY-MM-DD.");
  return new Date(`${iso}T00:00:00Z`);
};
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** A price as exact text, never negative. */
function price(text: string, what: string): string {
  try {
    const k = toKobo(text);
    if (k < 0) throw new BusinessError(`${what} must be an amount of 0 or more.`);
    return koboToString(k);
  } catch (e) {
    if (e instanceof MoneyError) throw new BusinessError(`${what}: ${e.message}`);
    throw e;
  }
}

export async function createPriceBook(ctx: Ctx, draft: PriceBookDraft) {
  assertKeeper(ctx);
  const effectiveFrom = dateOnly(draft.effectiveFrom);
  const currency = draft.currency ?? "NGN";
  if (!(CURRENCY_CODES as string[]).includes(currency)) throw new BusinessError(`There is no currency called "${currency}".`);
  const minimumMonthly = price(draft.minimumMonthly, "The minimum monthly fee");
  const lines: Array<{ moduleKey: ModuleKey; basis: PriceBasis; amount: string }> = [];
  for (const [key, amount] of Object.entries(draft.lines)) {
    if (!(MODULE_KEYS as readonly string[]).includes(key)) throw new BusinessError(`There is no module called "${key}".`);
    const k = key as ModuleKey;
    if (k === "core") throw new BusinessError("The core is included in every plan and has no price.");
    if (MODULES[k].status === "planned") throw new BusinessError(`${MODULES[k].name} is not available yet, so it cannot be priced.`);
    lines.push({ moduleKey: k, basis: MODULES[k].chargedPer as PriceBasis, amount: price(amount, `The price of ${MODULES[k].name}`) });
  }
  if (await db.softwarePriceBook.findUnique({ where: { currency_effectiveFrom: { currency, effectiveFrom } } })) throw new BusinessError(`There is already a price book starting on ${draft.effectiveFrom} in ${currency}.`);
  return db.$transaction(async (tx) => {
    const book = await tx.softwarePriceBook.create({ data: { currency, effectiveFrom, minimumMonthly, note: draft.note?.trim() || null, createdBy: ctx.name, createdByUserId: ctx.userId } });
    if (lines.length) await tx.softwarePriceLine.createMany({ data: lines.map((l) => ({ bookId: book.id, ...l })) });
    await logAudit(ctx, { action: "PRICE_BOOK_CREATED", entity: "SoftwarePriceBook", entityId: book.id, newValue: { effectiveFrom: draft.effectiveFrom, currency, lines: lines.map((l) => l.moduleKey) } }, tx);
    return book;
  });
}

/** A second person confirms the version: never its maker, and once only. From then on it can never be changed or deleted. */
export async function verifyPriceBook(ctx: Ctx, id: string) {
  assertKeeper(ctx);
  const book = await db.softwarePriceBook.findUnique({ where: { id } });
  if (!book) throw new BusinessError("That price book was not found.");
  if (book.verifiedAt) throw new BusinessError("That price book is already verified.");
  if (book.createdByUserId === ctx.userId) throw new BusinessError("A price book must be verified by someone other than the person who made it.");
  await db.$transaction(async (tx) => {
    await tx.softwarePriceBook.update({ where: { id }, data: { verifiedAt: new Date(), verifiedBy: ctx.name, verifiedByUserId: ctx.userId } });
    await logAudit(ctx, { action: "PRICE_BOOK_VERIFIED", entity: "SoftwarePriceBook", entityId: id, newValue: { effectiveFrom: isoDay(book.effectiveFrom), currency: book.currency } }, tx);
  });
}

export async function deletePriceBookDraft(ctx: Ctx, id: string) {
  assertKeeper(ctx);
  const book = await db.softwarePriceBook.findUnique({ where: { id } });
  if (!book) throw new BusinessError("That price book was not found.");
  if (book.verifiedAt) throw new BusinessError("A verified price book cannot be deleted; add a new version from a later date.");
  await db.$transaction(async (tx) => {
    await tx.softwarePriceBook.delete({ where: { id } });
    await logAudit(ctx, { action: "PRICE_BOOK_DRAFT_DELETED", entity: "SoftwarePriceBook", entityId: id }, tx);
  });
}

export async function listPriceBooks(ctx: Ctx) {
  assertKeeper(ctx);
  return db.softwarePriceBook.findMany({ orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }], include: { lines: { orderBy: { moduleKey: "asc" } } } });
}

/** The verified version in force on a day: the one with the latest start on or before it. Null before the first. A draft is never used. */
export async function activeBook(at: Date = new Date(), currency = "NGN"): Promise<PriceBookData | null> {
  const day = new Date(`${at.toISOString().slice(0, 10)}T00:00:00Z`);
  const book = await db.softwarePriceBook.findFirst({ where: { currency, verifiedAt: { not: null }, effectiveFrom: { lte: day } }, orderBy: { effectiveFrom: "desc" }, include: { lines: true } });
  if (!book) return null;
  return {
    currency: book.currency,
    effectiveFrom: isoDay(book.effectiveFrom),
    minimumMonthly: book.minimumMonthly.toFixed(2),
    lines: book.lines.map((l) => ({ moduleKey: l.moduleKey as ModuleKey, basis: l.basis as PriceBasis, amount: l.amount.toFixed(2) })),
  };
}

/**
 * Configures a prospect from the questionnaire's answers, then prices the blueprint from the version in force on `at`. The VAT rate is the one in the seller's own rate card
 * (the bureau's pricing setting), not a second copy; with none, the quote has no VAT line and still stands. Saving the quote with a blueprint is a later step (E4c).
 */
export async function quoteBlueprint(ctx: Ctx, answers: Answers, at: Date = new Date()): Promise<{ configured: Configured; quote: Quote | null }> {
  await assertSeller(ctx);
  const configured = configureClient(answers);
  if (!configured.ok) return { configured, quote: null };
  const rate = await db.pricingSetting.findUnique({ where: { organizationId: ctx.homeOrgId ?? ctx.orgId }, select: { vatRatePct: true } });
  const quote = priceBlueprint({ modules: configured.modules, employees: answers.employees, crmUsers: configured.limits.crmUserLimit, book: await activeBook(at), vatRatePct: rate ? rate.vatRatePct.toFixed(2) : null });
  return { configured, quote };
}
