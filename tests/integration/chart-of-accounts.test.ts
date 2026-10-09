import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { isolatedOrg } from "../helpers";
import { standardAccounts } from "@/lib/standard-chart";
import { DEFAULT_ACCOUNTS, chartTree, createAccount, createCategory, createGroup, ensureDefaultChart, installStandardChart, updateAccount } from "@/server/services/accounting";
import { postJournal } from "@/server/services/posting";

const day = (s: string) => new Date(`${s}T00:00:00Z`);

async function world() {
  const t = await isolatedOrg();
  await db.$transaction((tx) => ensureDefaultChart(tx, t.org.id));
  const fin = t.ctx("FINANCE");
  const acct = (code: string) => db.glAccount.findUniqueOrThrow({ where: { organizationId_code: { organizationId: t.org.id, code } } });
  const post = (code: string, over: Record<string, unknown> = {}) =>
    postJournal(fin, db, {
      source: "MANUAL_POST",
      postingDate: day("2026-08-31"),
      description: "test",
      lines: [{ accountCode: code, description: "a", debit: 100, credit: 0 }, { accountCode: "4100", description: "b", debit: 0, credit: 100 }],
      ...over,
    } as never);
  return { t, fin, acct, post };
}

describe("installing the standard chart", () => {
  it("adds the groups, categories and missing accounts, and places every existing account in a category", async () => {
    const { t, fin } = await world();
    const before = await db.glAccount.count({ where: { organizationId: t.org.id } });
    expect(before).toBe(DEFAULT_ACCOUNTS.length);
    const r = await installStandardChart(fin);
    expect(r.groups).toBeGreaterThan(20);
    expect(r.categories).toBeGreaterThan(30);
    expect(r.classified).toBe(DEFAULT_ACCOUNTS.length);
    expect(r.created).toBe(standardAccounts().length - DEFAULT_ACCOUNTS.length);
    const tree = await chartTree(fin);
    expect(tree.unclassified).toEqual([]);
    expect(tree.total).toBe(standardAccounts().length);
    expect(tree.tree.map((g) => g.classNumber)).toEqual([...tree.tree.map((g) => g.classNumber)].sort((a, b) => a - b)); // classes in order
    // receivables sits where it should
    const ar = await db.glAccount.findUniqueOrThrow({ where: { organizationId_code: { organizationId: t.org.id, code: "1200" } }, include: { category: { include: { group: true } } } });
    expect([ar.category?.name, ar.category?.group.classNumber, ar.category?.statementLine]).toEqual(["Client receivables", 1, "TRADE_RECEIVABLES"]);
  });

  it("never renames, retypes, recodes or reclassifies an account that already exists, and can be run again for no change", async () => {
    const { t, fin, acct } = await world();
    await updateAccount(fin, (await acct("1200")).id, { name: "Trade Debtors (our name)" });
    // an account of the user's own that happens to use a standard code for a different kind of account
    await db.glAccount.create({ data: { organizationId: t.org.id, code: "6001", name: "My odd asset", type: "ASSET" } });
    const first = await installStandardChart(fin);
    expect(first.skipped).toBe(1);
    expect((await acct("1200")).name).toBe("Trade Debtors (our name)");
    const odd = await acct("6001");
    expect([odd.name, odd.type, odd.categoryId]).toEqual(["My odd asset", "ASSET", null]);
    const again = await installStandardChart(fin);
    expect(again).toEqual({ groups: 0, categories: 0, created: 0, classified: 0, skipped: 1 });
    expect(await db.glAccount.count({ where: { organizationId: t.org.id } })).toBe(standardAccounts().length);
  });

  it("is audited, needs the manage permission, and is per organization", async () => {
    const { t, fin } = await world();
    await expect(installStandardChart(t.ctx("HR_ADMIN"))).rejects.toThrow(/permission/i);
    await expect(installStandardChart(t.ctx("AUDITOR"))).rejects.toThrow(/permission/i);
    await installStandardChart(fin);
    expect(await db.auditLog.count({ where: { organizationId: t.org.id, action: "GL_STANDARD_CHART_INSTALL" } })).toBe(1);
    const other = await isolatedOrg();
    expect(await db.accountGroup.count({ where: { organizationId: other.org.id } })).toBe(0);
  });

  it("keeps every account the system posts to usable afterwards", async () => {
    const { fin, post } = await world();
    await installStandardChart(fin);
    await expect(post("1230")).resolves.toBeTruthy(); // operating cash, posted to by receipts and payments
  });
});

describe("accounts in the hierarchy", () => {
  it("must suit their category's class", async () => {
    const { fin } = await world();
    await installStandardChart(fin);
    const cat = await db.accountCategory.findFirstOrThrow({ where: { organizationId: fin.orgId, code: "C1020" } }); // bank accounts, class 1
    await expect(createAccount(fin, { code: "9001", name: "Not an asset", type: "INCOME", categoryId: cat.id } as never)).rejects.toThrow(/income account can't sit in Bank accounts/i);
    await expect(createAccount(fin, { code: "9002", name: "Bank — Savings", type: "ASSET", categoryId: cat.id } as never)).resolves.toMatchObject({ code: "9002" });
    await expect(createAccount(fin, { code: "9003", name: "Nowhere", type: "ASSET", categoryId: "no-such-category" } as never)).rejects.toThrow(/doesn't exist/);
  });

  it("can be sub-accounts: the parent becomes a header, the engine refuses to post to it, and the sub-account takes the postings", async () => {
    const { fin, acct, post } = await world();
    const parent = await createAccount(fin, { code: "1300", name: "Bank balances", type: "ASSET" } as never);
    await createAccount(fin, { code: "1301", name: "Bank — Lagos", type: "ASSET", parentId: parent.id } as never);
    expect((await acct("1300")).postable).toBe(false);
    await expect(post("1300")).rejects.toThrow(/is a header that groups other accounts/);
    await expect(post("1301")).resolves.toBeTruthy();
    const tree = await chartTree(fin);
    const flat = tree.unclassified.map((a) => `${a.depth}:${a.code}`);
    expect(flat.indexOf("1:1301")).toBe(flat.indexOf("0:1300") + 1); // the child sits right under its parent, one level in
  });

  it("refuses a parent of another type, a parent that already has postings, and a loop", async () => {
    const { fin, acct, post } = await world();
    const liability = await createAccount(fin, { code: "2900", name: "A liability", type: "LIABILITY" } as never);
    await expect(createAccount(fin, { code: "1390", name: "Child", type: "ASSET", parentId: liability.id } as never)).rejects.toThrow(/same type as its parent/);

    await post("1230"); // 1230 now has postings
    const cash = await acct("1230");
    await expect(createAccount(fin, { code: "1391", name: "Child of cash", type: "ASSET", parentId: cash.id } as never)).rejects.toThrow(/already has postings/);

    const a = await createAccount(fin, { code: "1400", name: "Top", type: "ASSET" } as never);
    const b = await createAccount(fin, { code: "1401", name: "Middle", type: "ASSET", parentId: a.id } as never);
    const c = await createAccount(fin, { code: "1402", name: "Bottom", type: "ASSET", parentId: b.id } as never);
    await expect(updateAccount(fin, a.id, { parentId: c.id })).rejects.toThrow(/under itself or one of its own sub-accounts/);
    await expect(updateAccount(fin, a.id, { parentId: a.id })).rejects.toThrow(/under itself/);
  });

  it("refuses to make an account a header while a payroll head posts to it", async () => {
    const { fin, acct } = await world();
    const basic = await acct("5100"); // mapped to the BASIC payroll head
    await expect(createAccount(fin, { code: "5101", name: "Basic — night shift", type: "EXPENSE", parentId: basic.id } as never)).rejects.toThrow(/payroll-head mapping|already has postings/);
  });

  it("restores a parent to postable when its last sub-account is taken out", async () => {
    const { fin, acct } = await world();
    const parent = await createAccount(fin, { code: "1500", name: "Parent", type: "ASSET" } as never);
    const child = await createAccount(fin, { code: "1501", name: "Child", type: "ASSET", parentId: parent.id } as never);
    expect((await acct("1500")).postable).toBe(false);
    await updateAccount(fin, child.id, { parentId: null });
    expect((await acct("1500")).postable).toBe(true);
  });

  it("never lets the code or type change, whatever is sent", async () => {
    const { fin, acct } = await world();
    const before = await acct("1200");
    await updateAccount(fin, before.id, { name: "Renamed", code: "9999", type: "EXPENSE" } as never);
    const after = await acct("1200");
    expect([after.code, after.type, after.name]).toEqual(["1200", "ASSET", "Renamed"]);
  });
});

describe("effective dates", () => {
  it("stop an account being used before it starts or after it ends", async () => {
    const { fin, post } = await world();
    await createAccount(fin, { code: "6900", name: "Seasonal cost", type: "EXPENSE", effectiveFrom: "2026-09-01", effectiveTo: "2026-09-30" } as never);
    await expect(post("6900", { postingDate: day("2026-08-31") })).rejects.toThrow(/isn't effective until 2026-09-01/);
    await expect(post("6900", { postingDate: day("2026-10-01") })).rejects.toThrow(/stopped being effective on 2026-09-30/);
    await expect(post("6900", { postingDate: day("2026-09-01") })).resolves.toBeTruthy(); // the first day
    await expect(post("6900", { postingDate: day("2026-09-30") })).resolves.toBeTruthy(); // the last day
  });

  it("must not end before they start, and can be changed later", async () => {
    const { fin, acct } = await world();
    await expect(createAccount(fin, { code: "6901", name: "Backwards", type: "EXPENSE", effectiveFrom: "2026-09-30", effectiveTo: "2026-09-01" } as never)).rejects.toThrow(/can't end before it starts/);
    const a = await createAccount(fin, { code: "6902", name: "Open ended", type: "EXPENSE", effectiveFrom: "2026-01-01" } as never);
    await updateAccount(fin, a.id, { effectiveTo: "2026-06-30" });
    expect((await acct("6902")).effectiveTo?.toISOString().slice(0, 10)).toBe("2026-06-30");
    await updateAccount(fin, a.id, { effectiveTo: null });
    expect((await acct("6902")).effectiveTo).toBeNull();
    await expect(updateAccount(fin, a.id, { effectiveTo: "2025-12-31" })).rejects.toThrow(/can't end before it starts/);
  });
});

describe("groups, categories, statement lines and tax mapping", () => {
  it("creates a group and a category, and refuses bad input", async () => {
    const { fin } = await world();
    const g = await createGroup(fin, { classNumber: 6, code: "G6500", name: "Special costs" });
    await expect(createGroup(fin, { classNumber: 6, code: "G6500", name: "Dup" })).rejects.toThrow();
    await expect(createGroup(fin, { classNumber: 9, code: "G9", name: "No class" })).rejects.toThrow();
    const c = await createCategory(fin, { groupId: g.id, code: "C6510", name: "Camp costs", statementLine: "OPERATING_EXPENSES" });
    await expect(createCategory(fin, { groupId: g.id, code: "C6511", name: "Bad line", statementLine: "NOPE" })).rejects.toThrow(/isn't a financial-statement line/);
    await expect(createCategory(fin, { groupId: "nope", code: "C6512", name: "No group" })).rejects.toThrow(/doesn't exist/);
    const acct = await createAccount(fin, { code: "6510", name: "Camp hire", type: "EXPENSE", categoryId: c.id, statementLine: "COST_OF_SERVICES", taxMapping: "VAT_INPUT" } as never);
    expect([acct.statementLine, acct.taxMapping]).toEqual(["COST_OF_SERVICES", "VAT_INPUT"]);
    await expect(createAccount(fin, { code: "6511", name: "Bad", type: "EXPENSE", statementLine: "NOPE" } as never)).rejects.toThrow(/isn't a financial-statement line/);
  });

  it("only lets people with the manage permission change the chart, and keeps it per organization", async () => {
    const a = await world();
    const b = await world();
    await expect(createAccount(a.t.ctx("HR_ADMIN"), { code: "9100", name: "No", type: "ASSET" } as never)).rejects.toThrow(/permission/i);
    await expect(createGroup(a.t.ctx("AUDITOR"), { classNumber: 1, code: "GX", name: "No" })).rejects.toThrow(/permission/i);
    const foreign = await db.glAccount.findFirstOrThrow({ where: { organizationId: b.t.org.id, code: "1200" } });
    await expect(updateAccount(a.fin, foreign.id, { name: "Hijacked" })).rejects.toThrow(/not found/i);
    // the auditor can read the chart
    await expect(chartTree(a.t.ctx("AUDITOR"))).resolves.toMatchObject({ total: DEFAULT_ACCOUNTS.length });
  });
});
