import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { num } from "@/lib/money";
import { billingWorld } from "../billing-fixture";
import { generateInvoices } from "@/server/services/billing";
import { postJournal } from "@/server/services/posting";
import { periodFor, transitionPeriod } from "@/server/services/periods";
import { balanceSheet, incomeStatement, trialBalance } from "@/server/services/financial-statements";
import { ledgerByDimension } from "@/server/services/dimensions";
import { checkLedgerIntegrity } from "@/server/services/ledger-integrity";
import { closeFiscalYear, reopenFiscalYear, yearEndStatus } from "@/server/services/year-end";

const day = (s: string) => new Date(`${s}T00:00:00Z`);
const findings = async (orgId: string) => (await checkLedgerIntegrity(orgId)).findings.filter((f) => f.check !== "PAYROLL_UNPOSTED"); // the fixture's locked runs have no payroll journals

/**
 * An organization with a year of trading in 2026: invoices of 4,000,000 for June, July and August (revenue), and a
 * 1,500,000 expense for a cost centre in July. Periods June to August are closed; December is left open.
 */
async function world(expense = 1_500_000) {
  const w = await billingWorld();
  const fin = w.t.ctx("FINANCE", null, 1);
  const hr = w.t.ctx("HR_ADMIN", null, 1);
  const boss = w.t.ctx("COMPANY_ADMIN", null, 1);
  const boss2 = w.t.ctx("COMPANY_ADMIN", null, 2);
  const first = await w.addCharge(await w.newRun(2026, 6), 4_000_000);
  await w.addCharge(await w.newRun(2026, 7), 4_000_000, first);
  await w.addCharge(await w.newRun(2026, 8), 4_000_000, first);
  const runs = await db.payrollRun.findMany({ where: { organizationId: w.t.org.id }, orderBy: { period: { month: "asc" } } });
  for (const r of runs) await generateInvoices(fin, r.id, { vatPct: 0 });
  const cc = await db.costCenter.create({ data: { organizationId: w.t.org.id, code: "LAG", name: "Lagos" } });
  const acct = async (code: string) => (await db.glAccount.findFirstOrThrow({ where: { organizationId: w.t.org.id, code } })).id;
  const [cash, expenseAcct, income, retained] = await Promise.all([acct("1230"), acct("5400"), acct("4100"), (async () => (await db.glAccount.findFirst({ where: { organizationId: w.t.org.id, code: "3101" } }))?.id ?? (await db.glAccount.create({ data: { organizationId: w.t.org.id, code: "3101", name: "Retained Earnings", type: "EQUITY" } })).id)()]);
  if (expense)
    await db.$transaction((tx) =>
      postJournal(fin, tx, { source: "TEST", postingDate: day("2026-07-15"), description: "Office costs", lines: [{ accountId: expenseAcct, description: "Costs", debit: expense, credit: 0, dimensions: { costCenterId: cc.id } }, { accountId: cash, description: "Costs", debit: 0, credit: expense }] }),
    );
  const period = (date: string) => periodFor(db, w.t.org.id, day(date));
  const closeUp = async (...dates: string[]) => {
    for (const dt of dates) {
      const p = await period(dt);
      await transitionPeriod(fin, p.id, "SOFT_CLOSE");
      await transitionPeriod(boss, p.id, "CLOSE");
    }
  };
  const year = async () => (await period("2026-12-31")).fiscalYearId;
  return { ...w, fin, hr, boss, boss2, first, cc, retained, income, expenseAcct, period, closeUp, year };
}

const netOf = async (orgId: string, code: string, from: string, to: string) => {
  const a = await db.journalLine.aggregate({ where: { journal: { organizationId: orgId, postingDate: { gte: day(from), lte: day(to) } }, account: { organizationId: orgId, code } }, _sum: { debit: true, credit: true } });
  return num(a._sum.debit) - num(a._sum.credit);
};

describe("closing a financial year", () => {
  it("is refused while an earlier period with postings is still open, and says which", async () => {
    const { fin, boss, retained, year } = await world();
    await expect(closeFiscalYear(boss, await year(), retained)).rejects.toThrow(/Jun 2026 has postings and is still open\. Close it first/);
    const s = await yearEndStatus(fin, await year());
    expect(s.canClose).toBe(false);
    expect(s.problems.length).toBeGreaterThanOrEqual(3);
  });

  it("brings every income and expense account to nil with one journal dated the last day, and moves the profit to retained earnings", async () => {
    const { t, fin, boss, retained, cc, closeUp, year } = await world();
    await closeUp("2026-06-30", "2026-07-31", "2026-08-31");
    const status = await yearEndStatus(fin, await year());
    expect(status.canClose).toBe(true);
    expect(status.profit).toBe(12_000_000 - 1_500_000);
    const before = await balanceSheet(fin, "2026-12-31");
    const result = await closeFiscalYear(boss, await year(), retained);
    expect(result.profit).toBe(10_500_000);
    const journal = await db.journalEntry.findFirstOrThrow({ where: { id: result.journal.id }, include: { lines: true } });
    expect([journal.source, journal.postingDate.toISOString().slice(0, 10), journal.sourceType]).toEqual(["YEAR_END_CLOSE", "2026-12-31", "FISCAL_YEAR"]);
    // revenue cleared by a debit, the expense by a credit that keeps its cost centre, profit credited to retained earnings
    const byCode = async (code: string) => journal.lines.filter((l) => l.accountId === (undefined as never) || true).filter((l) => l.accountCode === code);
    expect((await byCode("4100")).reduce((s, l) => s + num(l.debit), 0)).toBe(12_000_000);
    const exp = (await byCode("5400"))[0];
    expect([num(exp.credit), exp.costCenterId]).toEqual([1_500_000, cc.id]);
    expect((await byCode("3101")).map((l) => [num(l.credit), num(l.debit)])).toEqual([[10_500_000, 0]]);
    // every income and expense account nets to nil over the year, closing journal included
    expect(await netOf(t.org.id, "4100", "2026-01-01", "2026-12-31")).toBe(0);
    expect(await netOf(t.org.id, "5400", "2026-01-01", "2026-12-31")).toBe(0);
    // equity is unchanged: the profit just moved from "this year" to retained earnings
    const after = await balanceSheet(fin, "2026-12-31");
    expect(after.equity.total).toBe(before.equity.total);
    expect(after.assets.total).toBe(before.assets.total);
    expect(after.equity.retainedEarnings).toBe(0);
    // the trial balance after closing shows the P&L accounts at nil
    const tb = await trialBalance(fin, "2026-12-31");
    expect(tb.rows.filter((r) => r.account.code === "4100" || r.account.code === "5400").map((r) => [r.debitBalance, r.creditBalance])).toEqual([[0, 0], [0, 0]]);
    expect(tb.balanced).toBe(true);
    const yr = await db.fiscalYear.findUniqueOrThrow({ where: { id: await year() } });
    expect([yr.closedBy, yr.closingJournalId, yr.retainedEarningsAccountId]).toEqual([boss.name, journal.id, retained]);
    expect(await findings(t.org.id)).toEqual([]);
  });

  it("leaves the year's performance readable: the income statement and dimension report ignore the closing journal", async () => {
    const { fin, boss, retained, cc, closeUp, year } = await world();
    await closeUp("2026-06-30", "2026-07-31", "2026-08-31");
    await closeFiscalYear(boss, await year(), retained);
    const is = await incomeStatement(fin, "2026-01-01", "2026-12-31");
    expect([is.revenue, is.totalExpenses, is.netIncome]).toEqual([12_000_000, 1_500_000, 10_500_000]);
    const december = await incomeStatement(fin, "2026-12-01", "2026-12-31");
    expect(december.netIncome).toBe(0); // nothing happened in December; the closing journal is not "performance"
    const byCc = await ledgerByDimension(fin, { dimension: "COST_CENTER", from: "2026-01-01", to: "2026-12-31" });
    expect(byCc.rows.find((r) => r.id === cc.id)).toMatchObject({ expense: 1_500_000 });
  });

  it("is checked: an equity account, active and postable", async () => {
    const { t, boss, closeUp, year, income } = await world();
    await closeUp("2026-06-30", "2026-07-31", "2026-08-31");
    await expect(closeFiscalYear(boss, await year(), income)).rejects.toThrow(/Choose an equity account/);
    await expect(closeFiscalYear(boss, await year(), "nope")).rejects.toThrow(/Choose an equity account/);
    const inactive = await db.glAccount.create({ data: { organizationId: t.org.id, code: "3199", name: "Old reserve", type: "EQUITY", active: false } });
    await expect(closeFiscalYear(boss, await year(), inactive.id)).rejects.toThrow(/can't be posted to/);
  });

  it("has nothing to close in a year without income or expense", async () => {
    const w = await billingWorld();
    const boss = w.t.ctx("COMPANY_ADMIN", null, 1);
    await db.$transaction((tx) => import("@/server/services/accounting").then((m) => m.ensureDefaultChart(tx, w.t.org.id)));
    const re = await db.glAccount.create({ data: { organizationId: w.t.org.id, code: "3101", name: "Retained Earnings", type: "EQUITY" } });
    const p = await periodFor(db, w.t.org.id, day("2027-12-31"));
    await expect(closeFiscalYear(boss, p.fiscalYearId, re.id)).rejects.toThrow(/has no income or expense postings to close/);
    expect((await yearEndStatus(boss, p.fiscalYearId)).nothingToClose).toBe(true);
  });
});

describe("a loss", () => {
  it("is moved to retained earnings as a debit", async () => {
    const { t, boss, retained, closeUp, year } = await world(15_000_000);
    await closeUp("2026-06-30", "2026-07-31", "2026-08-31");
    const r = await closeFiscalYear(boss, await year(), retained);
    expect(r.profit).toBe(-3_000_000);
    const re = await db.journalLine.findFirstOrThrow({ where: { journalId: r.journal.id, accountCode: "3101" } });
    expect([num(re.debit), num(re.credit)]).toEqual([3_000_000, 0]);
    expect(await findings(t.org.id)).toEqual([]);
  });
});

describe("after the year is closed", () => {
  it("refuses income and expense postings dated in it, allows balance sheet and next-year postings", async () => {
    const { fin, boss, retained, expenseAcct, closeUp, year, t } = await world();
    await closeUp("2026-06-30", "2026-07-31", "2026-08-31");
    await closeFiscalYear(boss, await year(), retained);
    const cash = (await db.glAccount.findFirstOrThrow({ where: { organizationId: t.org.id, code: "1230" } })).id;
    const liability = (await db.glAccount.findFirstOrThrow({ where: { organizationId: t.org.id, code: "2130" } })).id;
    const post = (date: string, debit: string) =>
      db.$transaction((tx) =>
        postJournal(fin, tx, { source: "TEST", postingDate: day(date), description: "Later", lines: [{ accountId: debit === "expense" ? expenseAcct : liability, description: "x", debit: 1000, credit: 0 }, { accountId: cash, description: "x", debit: 0, credit: 1000 }] }),
      );
    await expect(post("2026-11-15", "expense")).rejects.toThrow(/2026 has been closed.*nothing more can be posted to income or expense/);
    await expect(post("2026-11-15", "liability")).resolves.toBeTruthy(); // a balance sheet movement is fine
    await expect(post("2027-01-15", "expense")).resolves.toBeTruthy(); // the new year is open
  });

  it("is reopened by reversing the closing journal exactly, with a reason, and can be closed again", async () => {
    const { t, fin, boss, hr, retained, closeUp, year } = await world();
    await closeUp("2026-06-30", "2026-07-31", "2026-08-31");
    const closed = await closeFiscalYear(boss, await year(), retained);
    await expect(reopenFiscalYear(hr, await year(), "Reopened by someone who may not")).rejects.toThrow(/permission/i);
    await expect(reopenFiscalYear(boss, await year(), "short")).rejects.toThrow(/Say why/);
    const reversal = await reopenFiscalYear(boss, await year(), "A late invoice for November has to be posted");
    expect(reversal!.reversalOfId).toBe(closed.journal.id);
    expect(reversal!.source).toBe("YEAR_END_REOPEN");
    const yr = await db.fiscalYear.findUniqueOrThrow({ where: { id: await year() } });
    expect([yr.closedAt, yr.closingJournalId]).toEqual([null, null]);
    // the P&L is back as it was, and the income statement did not move
    expect(await netOf(t.org.id, "4100", "2026-01-01", "2026-12-31")).toBe(-12_000_000);
    expect((await incomeStatement(fin, "2026-01-01", "2026-12-31")).netIncome).toBe(10_500_000);
    await expect(reopenFiscalYear(boss, await year(), "Reopening a year that is not closed")).rejects.toThrow(/isn't closed/);
    expect(await findings(t.org.id)).toEqual([]);
    const again = await closeFiscalYear(boss, await year(), retained);
    expect(again.journal.id).not.toBe(closed.journal.id);
    expect(await findings(t.org.id)).toEqual([]);
  });

  it("can't be reopened once the last period has closed, until that period is reopened", async () => {
    const { fin, boss, retained, period, closeUp, year } = await world();
    await closeUp("2026-06-30", "2026-07-31", "2026-08-31");
    await closeFiscalYear(boss, await year(), retained);
    await closeUp("2026-12-31"); // closes December, with its checks and snapshot
    const dec = await period("2026-12-31");
    expect(await db.periodSnapshot.count({ where: { periodId: dec.id } })).toBe(1);
    await expect(reopenFiscalYear(boss, await year(), "Wanting to reopen with December closed")).rejects.toThrow(/Reopen it first/);
    await transitionPeriod(boss, dec.id, "REOPEN", "A late invoice for November has to be posted");
    await expect(reopenFiscalYear(boss, await year(), "A late invoice for November has to be posted")).resolves.toBeTruthy();
    void fin;
  });

  it("can't be closed again, and the closed-year fields can't be set or cleared by themselves in the database", async () => {
    const { t, boss, retained, closeUp, year } = await world();
    await closeUp("2026-06-30", "2026-07-31", "2026-08-31");
    await closeFiscalYear(boss, await year(), retained);
    await expect(closeFiscalYear(boss, await year(), retained)).rejects.toThrow(/already been closed/);
    await expect(db.fiscalYear.update({ where: { id: await year() }, data: { closingJournalId: null } })).rejects.toThrow(/closed with its closing journal, or not closed at all/);
    await expect(db.fiscalYear.update({ where: { id: await year() }, data: { closedAt: null } })).rejects.toThrow(/closed with its closing journal, or not closed at all/);
    void t;
  });

  it("is noticed by the integrity check if a closed year's accounts are later disturbed behind the engine's back", async () => {
    const { t, boss, retained, closeUp, year, income } = await world();
    await closeUp("2026-06-30", "2026-07-31", "2026-08-31");
    await closeFiscalYear(boss, await year(), retained);
    expect((await findings(t.org.id)).filter((f) => f.check === "YEAR_NOT_AT_NIL")).toEqual([]);
    const cash = await db.glAccount.findFirstOrThrow({ where: { organizationId: t.org.id, code: "1230" } });
    const rev = await db.glAccount.findUniqueOrThrow({ where: { id: income } });
    await db.journalEntry.create({
      data: {
        organizationId: t.org.id, entryNumber: "JV-RAW-1", postingDate: day("2026-11-20"), description: "Raw insert", source: "TEST", totalDebit: 500, totalCredit: 500, postedBy: "test",
        lines: { create: [{ accountId: cash.id, accountCode: cash.code, accountName: cash.name, headCode: "", description: "x", debit: 500, credit: 0 }, { accountId: rev.id, accountCode: rev.code, accountName: rev.name, headCode: "", description: "x", debit: 0, credit: 500 }] },
      },
    });
    const bad = (await findings(t.org.id)).filter((f) => f.check === "YEAR_NOT_AT_NIL");
    expect(bad).toHaveLength(1);
    expect(bad[0].message).toContain("FY2026 is closed but 1 income or expense account(s) are not at nil");
  });
});

describe("who may do it, and per organization", () => {
  it("needs the approver's permission to close and the reopen permission to reopen", async () => {
    const { fin, hr, retained, closeUp, year } = await world();
    await closeUp("2026-06-30", "2026-07-31", "2026-08-31");
    await expect(closeFiscalYear(fin, await year(), retained)).rejects.toThrow(/permission/i);
    await expect(closeFiscalYear(hr, await year(), retained)).rejects.toThrow(/permission/i);
  });

  it("keeps one organization's years from another's", async () => {
    const mine = await world();
    const other = await world();
    await expect(closeFiscalYear(other.boss, await mine.year(), other.retained)).rejects.toThrow(/Financial year not found/);
    await expect(yearEndStatus(other.fin, await mine.year())).rejects.toThrow(/Financial year not found/);
  });
});
