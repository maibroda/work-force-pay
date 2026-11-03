import { describe, expect, it } from "vitest";
import type { Ctx } from "@/lib/auth/context";
import { can, type Role } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { activeBook, createPriceBook, deletePriceBookDraft, listPriceBooks, quoteBlueprint, verifyPriceBook } from "@/server/services/price-book";
import { isolatedOrg, uid } from "../helpers";

/**
 * Step E4b of docs/plans/module-entitlements-e4.md: the software price book. Platform staff keep it, two people verify each version, a verified version can never be changed, and a
 * quote uses only the version in force on its day. **Every amount here is a TEST value**; the founder's prices are entered through the screen and never in code. Verified versions
 * cannot be removed from the database, so each test uses its own start year: a later test's version always wins over an earlier one, and "before any version" is 2099.
 */
const ctx = (orgId: string, role: Role, n = 1): Ctx => ({ userId: `${orgId}-${role}-${n}`, orgId, role, name: `${role} ${n}`, email: `${role.toLowerCase()}${n}@${orgId}.test`, employeeId: null });
const LINES = { payroll: "1500.00", hr: "800.50", crm: "12000.00", analytics: "25000.00" };

async function world() {
  const t = await isolatedOrg();
  const code = `B${uid()}${uid()}`;
  const bureau = await db.organization.create({ data: { name: `Bureau ${code}`, code, isBureau: true } });
  return {
    t,
    bureau,
    staff: ctx(t.org.id, "SUPER_ADMIN", 1),
    staff2: ctx(t.org.id, "SUPER_ADMIN", 2),
    adminT: ctx(t.org.id, "COMPANY_ADMIN"),
    hrT: ctx(t.org.id, "HR_ADMIN"),
    bureauAdmin: ctx(bureau.id, "COMPANY_ADMIN"),
    sales: ctx(bureau.id, "BUSINESS_DEV"),
    salesElsewhere: ctx(t.org.id, "BUSINESS_DEV"), // a sales role in a company that is not a bureau
  };
}
const draft = (year: number, over: Record<string, unknown> = {}) => ({ effectiveFrom: `${year}-01-01`, minimumMonthly: "50000.00", lines: LINES, ...over });

describe("who may keep and use the price book", () => {
  it("gives the price book to platform staff only, withheld from a company's administrator who otherwise holds every permission; and quoting to platform staff and sales people", () => {
    expect(can("SUPER_ADMIN", "pricebook.manage")).toBe(true);
    expect(can("COMPANY_ADMIN", "pricebook.manage")).toBe(false);
    for (const r of ["HR_ADMIN", "BUSINESS_DEV", "FINANCE", "AUDITOR", "SALES_REP"] as Role[]) expect(can(r, "pricebook.manage"), r).toBe(false);
    for (const r of ["SUPER_ADMIN", "COMPANY_ADMIN", "BUSINESS_DEV"] as Role[]) expect(can(r, "blueprint.manage"), r).toBe(true);
    for (const r of ["HR_ADMIN", "FINANCE", "AUDITOR", "EMPLOYEE", "SALES_REP", "CLIENT_HR"] as Role[]) expect(can(r, "blueprint.manage"), r).toBe(false);
  });

  it("refuses everyone but platform staff the price book itself, and changes nothing", async () => {
    const w = await world();
    for (const who of [w.adminT, w.hrT, w.bureauAdmin, w.sales]) {
      await expect(createPriceBook(who, draft(2101))).rejects.toThrow(/permission/);
      await expect(listPriceBooks(who)).rejects.toThrow(/permission/);
      await expect(verifyPriceBook(who, "x")).rejects.toThrow(/permission/);
      await expect(deletePriceBookDraft(who, "x")).rejects.toThrow(/permission/);
    }
    expect(await db.softwarePriceBook.count({ where: { effectiveFrom: new Date("2101-01-01T00:00:00Z") } })).toBe(0);
  });
});

describe("making a version", () => {
  it("stores the lines with the basis the catalogue charges each module by, and the minimum, as a draft that is not yet in force", async () => {
    const w = await world();
    const b = await createPriceBook(w.staff, draft(2102, { note: "First" }));
    const lines = await db.softwarePriceLine.findMany({ where: { bookId: b.id }, orderBy: { moduleKey: "asc" } });
    expect(lines.map((l) => [l.moduleKey, l.basis, l.amount.toFixed(2)])).toEqual([
      ["analytics", "flat", "25000.00"],
      ["crm", "crm_user", "12000.00"],
      ["hr", "active_employee", "800.50"],
      ["payroll", "active_employee", "1500.00"],
    ]);
    expect(b).toMatchObject({ currency: "NGN", createdBy: w.staff.name, verifiedAt: null });
    expect(b.minimumMonthly.toFixed(2)).toBe("50000.00");
    expect(await activeBook(new Date("2102-06-01T00:00:00Z"))).toBeNull(); // a draft is never used
  });

  it("allows an empty book (no price set yet), and refuses what cannot be priced, with the reason", async () => {
    const w = await world();
    const empty = await createPriceBook(w.staff, { effectiveFrom: "2103-01-01", minimumMonthly: "0.00", lines: {} });
    expect(await db.softwarePriceLine.count({ where: { bookId: empty.id } })).toBe(0);
    await expect(createPriceBook(w.staff, draft(2104, { lines: { core: "10.00" } }))).rejects.toThrow(/core.*included/i);
    await expect(createPriceBook(w.staff, draft(2104, { lines: { production_pay: "10.00" } }))).rejects.toThrow(/not available yet/i);
    await expect(createPriceBook(w.staff, draft(2104, { lines: { teleportation: "10.00" } }))).rejects.toThrow(/no module called/i);
    for (const bad of ["-5.00", "10.005", "abc", "1,000.00"]) await expect(createPriceBook(w.staff, draft(2104, { lines: { payroll: bad } })), bad).rejects.toThrow(/amount|naira|kobo/i);
    await expect(createPriceBook(w.staff, draft(2104, { minimumMonthly: "-1.00" }))).rejects.toThrow(/minimum/i);
    await expect(createPriceBook(w.staff, draft(2104, { effectiveFrom: "next week" }))).rejects.toThrow(/date/i);
    await expect(createPriceBook(w.staff, draft(2104, { currency: "XXX" }))).rejects.toThrow(/currency/i);
    expect(await db.softwarePriceBook.count({ where: { effectiveFrom: new Date("2104-01-01T00:00:00Z") } })).toBe(0); // none of the refusals left anything
  });

  it("refuses a second version starting the same day in the same currency", async () => {
    const w = await world();
    await createPriceBook(w.staff, draft(2105));
    await expect(createPriceBook(w.staff, draft(2105))).rejects.toThrow(/already a price book starting/i);
  });

  it("can delete a draft, and only a draft", async () => {
    const w = await world();
    const a = await createPriceBook(w.staff, draft(2106));
    await deletePriceBookDraft(w.staff, a.id);
    expect(await db.softwarePriceBook.findUnique({ where: { id: a.id } })).toBeNull();
    expect(await db.softwarePriceLine.count({ where: { bookId: a.id } })).toBe(0);
    const b = await createPriceBook(w.staff, draft(2107));
    await verifyPriceBook(w.staff2, b.id);
    await expect(deletePriceBookDraft(w.staff, b.id)).rejects.toThrow(/verified/i);
  });
});

describe("verifying a version (two people)", () => {
  it("must be someone other than who made it, once, and is recorded; a verified version can then never be changed or deleted, by the application or the database", async () => {
    const w = await world();
    const b = await createPriceBook(w.staff, draft(2108));
    await expect(verifyPriceBook(w.staff, b.id)).rejects.toThrow(/someone other than/i);
    await expect(verifyPriceBook(w.staff2, "no-such-id")).rejects.toThrow(/not found/i);
    await verifyPriceBook(w.staff2, b.id);
    expect(await db.softwarePriceBook.findUniqueOrThrow({ where: { id: b.id } })).toMatchObject({ verifiedBy: w.staff2.name, verifiedByUserId: w.staff2.userId });
    await expect(verifyPriceBook(w.staff2, b.id)).rejects.toThrow(/already verified/i);
    // the database itself refuses (not only the service)
    await expect(db.$executeRaw`UPDATE "SoftwarePriceBook" SET "minimumMonthly" = 1 WHERE id = ${b.id}`).rejects.toThrow();
    await expect(db.$executeRaw`DELETE FROM "SoftwarePriceBook" WHERE id = ${b.id}`).rejects.toThrow();
    await expect(db.$executeRaw`UPDATE "SoftwarePriceLine" SET "amount" = 1 WHERE "bookId" = ${b.id}`).rejects.toThrow();
    await expect(db.$executeRaw`DELETE FROM "SoftwarePriceLine" WHERE "bookId" = ${b.id}`).rejects.toThrow();
    await expect(db.$executeRaw`INSERT INTO "SoftwarePriceLine" ("id","bookId","moduleKey","basis","amount") VALUES ('x1', ${b.id}, 'inventory', 'flat', 5)`).rejects.toThrow();
    expect((await db.softwarePriceLine.findMany({ where: { bookId: b.id } })).length).toBe(4);
  });

  it("is checked by the database too: the verifier can never be the maker", async () => {
    const w = await world();
    const b = await createPriceBook(w.staff, draft(2109));
    await expect(db.$executeRaw`UPDATE "SoftwarePriceBook" SET "verifiedAt" = now(), "verifiedBy" = 'x', "verifiedByUserId" = "createdByUserId" WHERE id = ${b.id}`).rejects.toThrow();
  });
});

describe("which version is in force", () => {
  it("is the verified version with the latest start on or before the day; a draft is ignored, and before the first there is none", async () => {
    const w = await world();
    const early = await createPriceBook(w.staff, draft(2110, { lines: { payroll: "100.00" } }));
    const late = await createPriceBook(w.staff, draft(2112, { lines: { payroll: "200.00" } }));
    const unverified = await createPriceBook(w.staff, draft(2111, { lines: { payroll: "999.00" } }));
    await verifyPriceBook(w.staff2, early.id);
    await verifyPriceBook(w.staff2, late.id);
    const pick = async (iso: string) => (await activeBook(new Date(`${iso}T00:00:00Z`)))?.lines.find((l) => l.moduleKey === "payroll")?.amount;
    expect(await pick("2110-06-01")).toBe("100.00");
    expect(await pick("2111-06-01")).toBe("100.00"); // the 2111 draft was never verified
    expect(await pick("2112-01-01")).toBe("200.00"); // on the first day
    expect(await pick("2113-06-01")).toBe("200.00");
    expect(await pick("2099-01-01")).toBeUndefined();
    expect(await activeBook(new Date("2099-01-01T00:00:00Z"))).toBeNull();
    expect(unverified.verifiedAt).toBeNull();
  });
});

describe("a quote", () => {
  it("is for platform staff and for sales people in a bureau, and not for anyone else, a sales role in an ordinary company included", async () => {
    const w = await world();
    const answers = { employees: 120, wants: { payroll: true } as never };
    const b = await createPriceBook(w.staff, draft(2114));
    await verifyPriceBook(w.staff2, b.id);
    const day = new Date("2114-06-01T00:00:00Z");
    for (const who of [w.staff, w.sales, w.bureauAdmin]) expect((await quoteBlueprint(who, answers, day)).quote?.ok, who.role).toBe(true);
    for (const who of [w.adminT, w.hrT, w.salesElsewhere]) await expect(quoteBlueprint(who, answers, day), `${who.role} in ${who.orgId}`).rejects.toThrow(/permission/);
  });

  it("configures, then prices from the version in force that day: the payroll for 120 employees at 1,500.00 is 180,000.00, with the VAT rate of the seller's own rate card", async () => {
    const w = await world();
    await db.pricingSetting.create({ data: { organizationId: w.bureau.id, hourlyCost: 1, softwareFixed: 1, softwarePerEmployee: 1, overheadPct: 10, targetMarginPct: 20, vatRatePct: 7.5, updatedBy: "test" } });
    const b = await createPriceBook(w.staff, draft(2115));
    await verifyPriceBook(w.staff2, b.id);
    const r = await quoteBlueprint(w.sales, { employees: 120, wants: { payroll: true } }, new Date("2115-03-01T00:00:00Z"));
    expect(r.configured.ok).toBe(true);
    expect(r.configured.proposed?.planKey).toBe("payroll_essentials");
    expect(r.quote).toMatchObject({ ok: true, monthly: "180000.00", vat: "13500.00", monthlyWithVat: "193500.00", priceBookFrom: "2115-01-01", currency: "NGN" });
    // without a rate card there is no VAT, and the quote still stands
    const noRate = await quoteBlueprint(w.staff, { employees: 120, wants: { payroll: true } }, new Date("2115-03-01T00:00:00Z"));
    expect(noRate.quote).toMatchObject({ ok: true, monthly: "180000.00", vat: null });
  });

  it("gives no quote for answers that cannot be used (the reasons are the configurator's), and none when no version is in force", async () => {
    const w = await world();
    const bad = await quoteBlueprint(w.staff, { employees: 0, wants: { payroll: true } }, new Date("2116-01-01T00:00:00Z"));
    expect(bad.configured.ok).toBe(false);
    expect(bad.quote).toBeNull();
    const none = await quoteBlueprint(w.staff, { employees: 10, wants: { payroll: true } }, new Date("2099-01-01T00:00:00Z"));
    expect(none.configured.ok).toBe(true);
    expect(none.quote).toMatchObject({ ok: false, monthly: null });
    expect(none.quote!.reasons).toEqual(["No price book is in force for this date."]);
  });

  it("shows no total for a module with no price, rather than leaving it out of the total", async () => {
    const w = await world();
    const b = await createPriceBook(w.staff, draft(2117, { lines: { payroll: "1500.00" } }));
    await verifyPriceBook(w.staff2, b.id);
    const r = await quoteBlueprint(w.staff, { employees: 50, wants: { payroll: true, inventory: true } }, new Date("2117-06-01T00:00:00Z"));
    expect(r.quote).toMatchObject({ ok: false, monthly: null, unpriced: ["inventory"] });
  });
});

describe("history", () => {
  it("lists every version, newest first, with who made and verified each, and prices nothing in the listing that is not in the book", async () => {
    const w = await world();
    const b = await createPriceBook(w.staff, draft(2118));
    await verifyPriceBook(w.staff2, b.id);
    const mine = (await listPriceBooks(w.staff)).find((x) => x.id === b.id)!;
    expect(mine).toMatchObject({ createdBy: w.staff.name, verifiedBy: w.staff2.name, lines: expect.any(Array) });
    expect(mine.lines).toHaveLength(4);
  });
});
