import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { isolatedOrg, uid } from "../helpers";
import { ensureDefaultChart } from "@/server/services/accounting";
import { postJournal } from "@/server/services/posting";
import { backfillJournalPeriods, createFiscalYear, ensureFiscalYear, listFiscalYears, periodFor, periodTrail, transitionPeriod } from "@/server/services/periods";
import { createPurchaseInvoice, createVendor } from "@/server/services/payables";
import { checkLedgerIntegrity } from "@/server/services/ledger-integrity";

const day = (s: string) => new Date(`${s}T00:00:00Z`);

/** A throwaway organization with the default chart. `admin` can do everything; `fin` can soft close and post when soft closed. */
async function world() {
  const t = await isolatedOrg();
  await db.$transaction((tx) => ensureDefaultChart(tx, t.org.id));
  const admin = t.ctx("COMPANY_ADMIN", null, 1);
  const admin2 = t.ctx("COMPANY_ADMIN", null, 2);
  const fin = t.ctx("FINANCE", null, 1);
  const hr = t.ctx("HR_ADMIN", null, 1);
  const post = (ctx = admin, date = "2026-08-31", over: Record<string, unknown> = {}) =>
    postJournal(ctx, db, {
      source: "MANUAL_POST",
      sourceType: "TEST_DOC",
      sourceId: `doc-${uid()}`,
      postingDate: day(date),
      description: "Test posting",
      lines: [
        { accountCode: "1230", description: "cash", debit: 1000, credit: 0 },
        { accountCode: "4100", description: "revenue", debit: 0, credit: 1000 },
      ],
      ...over,
    });
  const period = (date: string) => periodFor(db, t.org.id, day(date));
  return { t, admin, admin2, fin, hr, post, period };
}

describe("financial years and periods are created when needed", () => {
  it("the first posting into a year creates it with twelve open monthly periods, and stamps the journal", async () => {
    const { t, post } = await world();
    expect(await db.fiscalYear.count({ where: { organizationId: t.org.id } })).toBe(0);
    const j = (await post())!;
    const years = await db.fiscalYear.findMany({ where: { organizationId: t.org.id }, include: { periods: true } });
    expect(years).toHaveLength(1);
    expect(years[0].name).toBe("FY2026");
    expect(years[0].periods).toHaveLength(12);
    expect(years[0].periods.every((p) => p.status === "OPEN")).toBe(true);
    const aug = years[0].periods.find((p) => p.name === "Aug 2026")!;
    expect(j.periodId).toBe(aug.id);
    expect(j.sourceType).toBe("TEST_DOC");
    // a second posting reuses it
    await post(undefined, "2026-09-02");
    expect(await db.fiscalYear.count({ where: { organizationId: t.org.id } })).toBe(1);
    expect(await db.accountingPeriod.count({ where: { organizationId: t.org.id } })).toBe(12);
  });

  it("follows a financial year that doesn't start in January, and the boundary day goes to the right year", async () => {
    const { t, post } = await world();
    await db.organization.update({ where: { id: t.org.id }, data: { fiscalYearStartMonth: 4 } });
    const feb = (await post(undefined, "2026-02-15"))!;
    const apr = (await post(undefined, "2026-04-01"))!;
    const fy = async (periodId: string | null) => (await db.accountingPeriod.findUniqueOrThrow({ where: { id: periodId! }, include: { fiscalYear: true } })).fiscalYear.name;
    expect(await fy(feb.periodId)).toBe("FY2025/26");
    expect(await fy(apr.periodId)).toBe("FY2026/27");
  });

  it("can be created ahead of time, only by someone who may approve periods, and creating it twice is harmless", async () => {
    const { t, admin, fin } = await world();
    await expect(createFiscalYear(fin, "2027-06-01")).rejects.toThrow(/permission/i);
    const y = await createFiscalYear(admin, "2027-06-01");
    expect(y.name).toBe("FY2027");
    await createFiscalYear(admin, "2027-12-31");
    expect(await db.accountingPeriod.count({ where: { organizationId: t.org.id } })).toBe(12);
    const list = await listFiscalYears(admin);
    expect(list.years.map((x) => x.name)).toEqual(["FY2027"]);
    expect(await db.$transaction((tx) => ensureFiscalYear(tx, t.org.id, day("2027-03-03")))).toMatchObject({ name: "FY2027" });
  });
});

describe("the posting engine's refusals", () => {
  it("refuses an unbalanced journal, one line, a negative amount, a two-sided line, and a missing or inactive account", async () => {
    const { t, post } = await world();
    const lines = (l: Array<[string, number, number]>) => l.map(([accountCode, debit, credit]) => ({ accountCode, description: "x", debit, credit }));
    await expect(post(undefined, "2026-08-31", { lines: lines([["1230", 500, 0], ["4100", 0, 400]]) })).rejects.toThrow(/does not balance/);
    await expect(post(undefined, "2026-08-31", { lines: lines([["1230", 500, 0]]) })).rejects.toThrow(/at least two lines/);
    await expect(post(undefined, "2026-08-31", { lines: lines([["1230", -500, 0], ["4100", 0, -500]]) })).rejects.toThrow(/negative/);
    await expect(post(undefined, "2026-08-31", { lines: lines([["1230", 500, 100], ["4100", 0, 400]]) })).rejects.toThrow(/both debit and credit/);
    await expect(post(undefined, "2026-08-31", { lines: lines([["1230", 500, 0], ["9999", 0, 500]]) })).rejects.toThrow(/9999 is missing/);
    await db.glAccount.update({ where: { organizationId_code: { organizationId: t.org.id, code: "4100" } }, data: { active: false } });
    await expect(post(undefined, "2026-08-31", { lines: lines([["1230", 500, 0], ["4100", 0, 500]]) })).rejects.toThrow(/inactive/);
    expect(await db.journalEntry.count({ where: { organizationId: t.org.id } })).toBe(0);
  });

  it("won't post to another organization's account", async () => {
    const a = await world();
    const b = await world();
    // an account code that exists only in organization B
    await db.glAccount.create({ data: { organizationId: b.t.org.id, code: "8888", name: "Only B", type: "ASSET" } });
    await expect(a.post(undefined, "2026-08-31", { lines: [{ accountCode: "8888", description: "x", debit: 10, credit: 0 }, { accountCode: "4100", description: "x", debit: 0, credit: 10 }] })).rejects.toThrow(/8888 is missing/);
  });
});

describe("period status decides who can post", () => {
  it("a soft-closed period still takes finance's postings, and refuses anyone without the close permission", async () => {
    const { admin, fin, hr, post, period } = await world();
    const aug = await period("2026-08-31");
    await transitionPeriod(fin, aug.id, "SOFT_CLOSE");
    await expect(post(hr)).rejects.toThrow(/Aug 2026 is soft closed/);
    await expect(post(fin)).resolves.toBeTruthy();
    await expect(post(admin)).resolves.toBeTruthy(); // the administrator holds every permission
  });

  it("a closed period refuses everyone, even the administrator, until it is reopened with a reason", async () => {
    const { admin, admin2, fin, post, period } = await world();
    const aug = await period("2026-08-31");
    await transitionPeriod(fin, aug.id, "SOFT_CLOSE");
    await transitionPeriod(admin, aug.id, "CLOSE");
    await expect(post(admin)).rejects.toThrow(/Aug 2026 is closed/);
    await expect(post(fin)).rejects.toThrow(/closed/);
    await transitionPeriod(admin2, aug.id, "REOPEN", "A supplier invoice for August arrived after close.");
    await expect(post(fin)).resolves.toBeTruthy();
  });

  it("a locked period refuses everyone and can never be reopened", async () => {
    const { admin, fin, post, period } = await world();
    const aug = await period("2026-08-31");
    await transitionPeriod(fin, aug.id, "SOFT_CLOSE");
    await transitionPeriod(admin, aug.id, "CLOSE");
    await transitionPeriod(admin, aug.id, "LOCK");
    await expect(post(admin)).rejects.toThrow(/locked/);
    await expect(transitionPeriod(admin, aug.id, "REOPEN", "I would like to reopen this please and thank you.")).rejects.toThrow(/final/);
  });

  it("a business document and its journal stand or fall together: a bill dated into a closed period is not saved at all", async () => {
    const { t, admin, fin, period } = await world();
    const vendor = await createVendor(fin, { name: `Supplier ${uid()}`, category: "OTHER" });
    const sept = await period("2026-09-15");
    await transitionPeriod(fin, sept.id, "SOFT_CLOSE");
    await transitionPeriod(admin, sept.id, "CLOSE"); // January to August have nothing in them, so they don't hold it up
    await expect(createPurchaseInvoice(fin, { vendorId: vendor.id, description: "Late bill", invoiceDate: "2026-09-15", dueDate: "2026-10-15", lines: [{ description: "Item", quantity: 1, rate: 5000 }] })).rejects.toThrow(/Sep 2026 is closed/);
    expect(await db.purchaseInvoice.count({ where: { organizationId: t.org.id } })).toBe(0);
    expect(await db.journalEntry.count({ where: { organizationId: t.org.id } })).toBe(0);
    // a bill dated into an open period still works
    await expect(createPurchaseInvoice(fin, { vendorId: vendor.id, description: "On time", invoiceDate: "2026-10-05", dueDate: "2026-11-05", lines: [{ description: "Item", quantity: 1, rate: 5000 }] })).resolves.toBeTruthy();
  });
});

describe("closing is controlled", () => {
  it("needs the right permission at each step", async () => {
    const { hr, fin, admin, period } = await world();
    const jan = await period("2026-01-31");
    await expect(transitionPeriod(hr, jan.id, "SOFT_CLOSE")).rejects.toThrow(/permission/i);
    await transitionPeriod(fin, jan.id, "SOFT_CLOSE");
    await expect(transitionPeriod(fin, jan.id, "CLOSE")).rejects.toThrow(/permission/i); // finance can soft close but not close
    await expect(transitionPeriod(fin, jan.id, "REOPEN", "I want to reopen January for a reason.")).rejects.toThrow(/permission/i);
    await transitionPeriod(admin, jan.id, "CLOSE");
  });

  it("closes and locks in order, but only periods that have postings hold the order up", async () => {
    const { admin, fin, post, period } = await world();
    await post(admin, "2026-01-15");
    await post(admin, "2026-02-15");
    const jan = await period("2026-01-31");
    const feb = await period("2026-02-28");
    const mar = await period("2026-03-31"); // empty, and it comes after February
    await transitionPeriod(fin, feb.id, "SOFT_CLOSE");
    await expect(transitionPeriod(admin, feb.id, "CLOSE")).rejects.toThrow(/Jan 2026 has postings and is still open\. Close the earlier periods first/);
    await transitionPeriod(fin, jan.id, "SOFT_CLOSE");
    await transitionPeriod(admin, jan.id, "CLOSE");
    await transitionPeriod(admin, feb.id, "CLOSE");
    await expect(transitionPeriod(admin, feb.id, "LOCK")).rejects.toThrow(/Jan 2026 has postings and is still only closed\. Lock the earlier periods first/);
    await transitionPeriod(admin, jan.id, "LOCK");
    await transitionPeriod(admin, feb.id, "LOCK");
    // March has no postings and can still be closed on its own, though Jan and Feb came first
    await transitionPeriod(fin, mar.id, "SOFT_CLOSE");
    await expect(transitionPeriod(admin, mar.id, "CLOSE")).resolves.toMatchObject({ status: "CLOSED" });
  });

  it("whoever soft closed a period can't also close it", async () => {
    const { admin, admin2, period } = await world();
    const jan = await period("2026-01-31");
    await transitionPeriod(admin, jan.id, "SOFT_CLOSE");
    await expect(transitionPeriod(admin, jan.id, "CLOSE")).rejects.toThrow(/someone else has to close it/);
    await expect(transitionPeriod(admin2, jan.id, "CLOSE")).resolves.toMatchObject({ status: "CLOSED" });
  });

  it("only moves along allowed steps, and reopening needs a real reason", async () => {
    const { admin, admin2, period } = await world();
    const jan = await period("2026-01-31");
    await expect(transitionPeriod(admin, jan.id, "CLOSE")).rejects.toThrow(/soft closed/);
    await expect(transitionPeriod(admin, jan.id, "LOCK")).rejects.toThrow(/closed/);
    await expect(transitionPeriod(admin, jan.id, "REOPEN", "A perfectly good reason here.")).rejects.toThrow(/soft closed or closed/);
    await transitionPeriod(admin, jan.id, "SOFT_CLOSE");
    await expect(transitionPeriod(admin2, jan.id, "REOPEN", "too short")).rejects.toThrow(/Say why/);
    await expect(transitionPeriod(admin2, jan.id, "REOPEN", "A perfectly good reason here.")).resolves.toMatchObject({ status: "OPEN" });
  });

  it("keeps a trail of who did what, why, and in what order, and audits each step", async () => {
    const { t, admin, admin2, fin, period } = await world();
    const jan = await period("2026-01-31");
    await transitionPeriod(fin, jan.id, "SOFT_CLOSE");
    await transitionPeriod(admin, jan.id, "CLOSE");
    await transitionPeriod(admin2, jan.id, "REOPEN", "A bank charge for January came to light late.");
    const trail = await periodTrail(admin, jan.id);
    expect(trail.map((e) => `${e.action}:${e.fromStatus}>${e.toStatus}`)).toEqual(["SOFT_CLOSE:OPEN>SOFT_CLOSED", "CLOSE:SOFT_CLOSED>CLOSED", "REOPEN:CLOSED>OPEN"]);
    expect(trail[2]).toMatchObject({ actor: admin2.name, reason: "A bank charge for January came to light late." });
    expect(await db.auditLog.count({ where: { organizationId: t.org.id, action: { in: ["PERIOD_SOFT_CLOSE", "PERIOD_CLOSE", "PERIOD_REOPEN"] } } })).toBe(3);
  });

  it("can't touch another organization's period", async () => {
    const a = await world();
    const b = await world();
    const bPeriod = await b.period("2026-01-31");
    await expect(transitionPeriod(a.admin, bPeriod.id, "SOFT_CLOSE")).rejects.toThrow(/not found/i);
  });
});

describe("the database itself keeps posted journals immutable", () => {
  it("rejects editing or deleting a posted journal or its lines, even straight through the database client", async () => {
    const { post } = await world();
    const j = (await post())!;
    const line = await db.journalLine.findFirstOrThrow({ where: { journalId: j.id } });
    await expect(db.journalEntry.update({ where: { id: j.id }, data: { description: "Changed" } })).rejects.toThrow(/cannot be edited/i);
    await expect(db.journalEntry.update({ where: { id: j.id }, data: { totalDebit: 5 } })).rejects.toThrow(/cannot be edited/i);
    await expect(db.journalEntry.delete({ where: { id: j.id } })).rejects.toThrow(/cannot be deleted/i);
    await expect(db.journalLine.update({ where: { id: line.id }, data: { debit: 999 } })).rejects.toThrow(/cannot be changed/i);
    await expect(db.journalLine.delete({ where: { id: line.id } })).rejects.toThrow(/cannot be deleted/i);
    await expect(db.journalLine.deleteMany({ where: { journalId: j.id } })).rejects.toThrow(/cannot be deleted/i);
    const after = await db.journalEntry.findUniqueOrThrow({ where: { id: j.id }, include: { lines: true } });
    expect(after.description).toBe("Test posting");
    expect(after.lines).toHaveLength(2);
  });

  it("allows an old journal to be stamped with its period and source once, and nothing else", async () => {
    const { t, period } = await world();
    const aug = await period("2026-08-31");
    const sept = await period("2026-09-30");
    const acct = await db.glAccount.findFirstOrThrow({ where: { organizationId: t.org.id, code: "1230" } });
    const old = await db.journalEntry.create({
      data: { organizationId: t.org.id, entryNumber: "JV-OLD001", postingDate: day("2026-08-31"), description: "Old", source: "AR_INVOICE", totalDebit: 10, totalCredit: 10, postedBy: "legacy", lines: { create: [{ accountId: acct.id, accountCode: "1230", accountName: acct.name, headCode: "x", description: "a", debit: 10, credit: 0 }, { accountId: acct.id, accountCode: "1230", accountName: acct.name, headCode: "x", description: "b", debit: 0, credit: 10 }] } },
    });
    await db.journalEntry.update({ where: { id: old.id }, data: { periodId: aug.id, sourceType: "CLIENT_INVOICE", sourceId: "inv-1" } }); // the one-time stamp
    await expect(db.journalEntry.update({ where: { id: old.id }, data: { periodId: sept.id } })).rejects.toThrow(/cannot be edited/i); // already stamped
    await expect(db.journalEntry.update({ where: { id: old.id }, data: { sourceId: "inv-2" } })).rejects.toThrow(/cannot be edited/i);
    await expect(db.journalEntry.update({ where: { id: old.id }, data: { periodId: null } })).rejects.toThrow(/cannot be edited/i);
  });

  it("refuses to delete an accounting period that has journals", async () => {
    const { post, period } = await world();
    await post();
    const aug = await period("2026-08-31");
    await expect(db.accountingPeriod.delete({ where: { id: aug.id } })).rejects.toThrow();
  });

  it("backfill stamps an unstamped journal with its period and is repeatable", async () => {
    const { t } = await world();
    const acct = await db.glAccount.findFirstOrThrow({ where: { organizationId: t.org.id, code: "1230" } });
    const mk = (n: string, date: string) =>
      db.journalEntry.create({
        data: { organizationId: t.org.id, entryNumber: n, postingDate: day(date), description: "Old", source: "MANUAL_POST", totalDebit: 10, totalCredit: 10, postedBy: "legacy", lines: { create: [{ accountId: acct.id, accountCode: "1230", accountName: acct.name, headCode: "x", description: "a", debit: 10, credit: 0 }, { accountId: acct.id, accountCode: "1230", accountName: acct.name, headCode: "x", description: "b", debit: 0, credit: 10 }] } },
      });
    await mk("JV-OLD010", "2026-03-10");
    await mk("JV-OLD011", "2027-01-05");
    expect(await backfillJournalPeriods(t.org.id)).toBe(2);
    expect(await backfillJournalPeriods(t.org.id)).toBe(0);
    const names = (await db.journalEntry.findMany({ where: { organizationId: t.org.id }, include: { period: true }, orderBy: { entryNumber: "asc" } })).map((j) => j.period?.name);
    expect(names).toEqual(["Mar 2026", "Jan 2027"]);
    expect((await checkLedgerIntegrity(t.org.id)).findings.map((f) => f.check)).not.toContain("JOURNAL_NO_PERIOD");
  });
});

describe("the integrity check understands periods and sources", () => {
  it("warns about a journal with no period, and about a document no journal points at", async () => {
    const { t, fin } = await world();
    const vendor = await createVendor(fin, { name: `Supplier ${uid()}`, category: "OTHER" });
    const bill = await createPurchaseInvoice(fin, { vendorId: vendor.id, description: "Bill", invoiceDate: "2026-09-01", dueDate: "2026-10-01", lines: [{ description: "Item", quantity: 1, rate: 1000 }] });
    expect((await checkLedgerIntegrity(t.org.id)).findings).toEqual([]); // posted through the engine: stamped and pointing at the bill
    expect(await db.journalEntry.count({ where: { organizationId: t.org.id, sourceType: "PURCHASE_INVOICE", sourceId: bill.id } })).toBe(1);

    // a bill whose journal is missing
    await db.purchaseInvoice.create({ data: { organizationId: t.org.id, vendorId: vendor.id, invoiceNumber: `PINV-X${uid()}`, invoiceDate: day("2026-09-02"), dueDate: day("2026-10-02"), description: "Orphan", subtotal: 500, totalAmount: 500, createdBy: "test" } });
    const r = await checkLedgerIntegrity(t.org.id);
    expect(r.findings.map((f) => f.check)).toContain("DOCUMENT_NO_JOURNAL");
    expect(r.findings.find((f) => f.check === "DOCUMENT_NO_JOURNAL")?.severity).toBe("WARN");
  });
});
