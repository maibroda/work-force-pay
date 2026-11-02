import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createCase, resolveCase } from "@/server/services/sales/cases";
import { createOpportunity } from "@/server/services/sales/pipelines";
import { createAccount } from "@/server/services/sales/records";
import { dashboard, drillRecords, reportCsv, widget, WIDGET_KEYS } from "@/server/services/sales/reports";
import { updateSalesSetting } from "@/server/services/sales/setting";
import { isolatedOrg } from "../helpers";

const d = (s: string) => new Date(s);

async function world() {
  const t = await isolatedOrg();
  const admin = t.ctx("COMPANY_ADMIN", null, 1);
  const repA = t.ctx("BUSINESS_DEV", null, 1);
  const repB = t.ctx("BUSINESS_DEV", null, 2);
  const ops = t.ctx("OPERATIONS", null, 1);
  for (const c of [admin, repA, repB, ops]) await db.user.create({ data: { id: c.userId, organizationId: t.org.id, email: c.email, name: c.name, passwordHash: "not-a-real-hash", role: c.role } });
  await updateSalesSetting(admin, { enabled: true });
  const accA = await createAccount(repA, { name: "Lekki Gardens Estate" });
  const accB = await createAccount(repB, { name: "Ikoyi Towers" });
  const first = await createOpportunity(repA, { accountId: accA.id, name: "Seed deal" });
  const stages = await db.crmStage.findMany({ where: { pipeline: { organizationId: t.org.id } }, orderBy: { sortOrder: "asc" } });
  const stage = (name: string) => stages.find((s) => s.name === name)!;
  const made = async (who: typeof repA, account: { id: string }, name: string, over: Record<string, unknown> = {}) => {
    const o = await createOpportunity(who, { accountId: account.id, name, monthlyContractValue: "1000000" });
    return db.crmOpportunity.update({ where: { id: o.id }, data: over });
  };
  return { t, admin, repA, repB, ops, accA, accB, stage, made, first };
}
type W = Awaited<ReturnType<typeof world>>;
const cells = (w: { rows: Array<{ cells: Array<string | number> }> }) => w.rows.map((r) => r.cells);

/** Closed deals: Ada's (repA) two wins and a loss, Bola's (repB) a win and two losses; each worked out beside the tests that use them. */
async function closedDeals(w: W) {
  const won = (who: typeof w.repA, acc: { id: string }, name: string, mcv: string, at: string, created: string, source: string) =>
    w.made(who, acc, name, { stageId: w.stage("Won").id, wonAt: d(at), createdAt: d(created), source, monthlyContractValue: mcv, probability: 100 });
  const lost = (who: typeof w.repA, acc: { id: string }, name: string, at: string, reason: string, competitor: string | null, source: string) =>
    w.made(who, acc, name, { stageId: w.stage("Lost").id, lostAt: d(at), lostReason: reason, competitor, source, probability: 0 });
  return {
    w1: await won(w.repA, w.accA, "A1", "1200000.00", "2026-08-10T10:00:00Z", "2026-07-01T10:00:00Z", "REFERRAL"),
    w2: await won(w.repA, w.accA, "A2", "800000.00", "2026-08-20T10:00:00Z", "2026-07-21T10:00:00Z", "TENDER"),
    l1: await lost(w.repA, w.accA, "A3", "2026-08-15T10:00:00Z", "PRICE", "SecureCo", "TENDER"),
    w3: await won(w.repB, w.accB, "B1", "500000.00", "2026-09-05T10:00:00Z", "2026-08-06T10:00:00Z", "REFERRAL"),
    l2: await lost(w.repB, w.accB, "B2", "2026-09-10T10:00:00Z", "PRICE", "SecureCo", "REFERRAL"),
    l3: await lost(w.repB, w.accB, "B3", "2026-09-12T10:00:00Z", "NO_DECISION", null, "WEBSITE"),
  };
}

describe("what each person's figures are made of", () => {
  it("counts a salesperson's own deals only, everyone's for a manager or Operations, and never another organization's", async () => {
    const w = await world();
    const other = await world();
    await w.made(w.repA, w.accA, "A open", {});
    await w.made(w.repB, w.accB, "B open", {});
    await other.made(other.repA, other.accA, "Other org", {});
    const total = async (who: typeof w.repA) => (await widget(who, "pipeline")).rows.at(-1)!.cells[1];
    expect(await total(w.repA)).toBe(2); // the seed deal and "A open"
    expect(await total(w.repB)).toBe(1);
    expect(await total(w.admin)).toBe(3);
    expect(await total(w.ops)).toBe(3); // Operations reads everything
    expect(await total(other.admin)).toBe(2);
    await expect(widget(w.t.ctx("AUDITOR", null, 1), "pipeline")).rejects.toThrow(/permission/i);
    await updateSalesSetting(w.admin, { enabled: false });
    await expect(widget(w.admin, "pipeline")).rejects.toThrow(/switched off/i);
  });

  it("gives the same win rates as the hand-worked dataset, for the whole organization and for each salesperson", async () => {
    const w = await world();
    await closedDeals(w);
    const rate = async (who: typeof w.repA, view: string, group: string) => cells(await widget(who, "win-rate")).find((c) => c[0] === view && c[1] === group);
    expect(await rate(w.admin, "Overall", "All deals")).toEqual(["Overall", "All deals", 3, 3, "50.0%"]);
    const ownerNames = cells(await widget(w.admin, "win-rate")).filter((c) => c[0] === "Owner").map((c) => c[2] + "/" + c[3]).sort();
    expect(ownerNames).toEqual(["1/2", "2/1"]); // one owner won 2 and lost 1, the other won 1 and lost 2
    expect(await rate(w.repA, "Overall", "All deals")).toEqual(["Overall", "All deals", 2, 1, "66.7%"]); // repA sees only their own three
    expect(await rate(w.repB, "Overall", "All deals")).toEqual(["Overall", "All deals", 1, 2, "33.3%"]);
    expect(await rate(w.admin, "Source", "REFERRAL")).toEqual(["Source", "REFERRAL", 2, 1, "66.7%"]);
    expect(cells(await widget(w.admin, "cycle"))).toEqual([[3, "33.3", 30, 40]]);
    expect(cells(await widget(w.admin, "lost-reasons"))).toEqual([["PRICE", 2, "66.7%"], ["NO_DECISION", 1, "33.3%"]]);
    expect(cells(await widget(w.admin, "competitors"))).toEqual([["SecureCo", 0, 2, "0.0%"]]); // none of the won deals here names a competitor
    expect(cells(await widget(w.admin, "source-revenue"))).toEqual([["REFERRAL", 2, "1700000.00"], ["TENDER", 1, "800000.00"], ["All sources", 3, "2500000.00"]]);
  });

  it("applies the date filter to when a deal was won or lost, in Lagos days, both ends included", async () => {
    const w = await world();
    await closedDeals(w);
    const overall = async (p: { from?: string; to?: string }) => cells(await widget(w.admin, "win-rate", p))[0].slice(2);
    expect(await overall({ from: "2026-08-01", to: "2026-08-31" })).toEqual([2, 1, "66.7%"]); // w1, w2 won; l1 lost
    expect(await overall({ from: "2026-09-01", to: "2026-09-30" })).toEqual([1, 2, "33.3%"]);
    expect(await overall({ from: "2026-08-10", to: "2026-08-10" })).toEqual([1, 0, "100.0%"]); // one day, inclusive
    expect(await overall({ from: "2027-01-01" })).toEqual([0, 0, "—"]);
    await expect(widget(w.admin, "win-rate", { from: "2026-09-01", to: "2026-08-01" })).rejects.toThrow(/cannot be before/i);
    await expect(widget(w.admin, "win-rate", { from: "yesterday" })).rejects.toThrow(/use dates like/i);
    await expect(widget(w.admin, "nonsense")).rejects.toThrow(/does not exist/i);
  });
});

describe("the drill-down", () => {
  it("names and links the records behind a figure, only those the viewer may see, and no more than 200", async () => {
    const w = await world();
    const c = await closedDeals(w);
    const row = (await widget(w.admin, "win-rate")).rows[0];
    expect(row.ids!.sort()).toEqual([c.w1.id, c.w2.id, c.w3.id, c.l1.id, c.l2.id, c.l3.id].sort());
    const recs = await drillRecords(w.admin, "deal", row.ids!);
    expect(recs).toHaveLength(6);
    expect(recs.find((r) => r.id === c.w1.id)).toEqual({ id: c.w1.id, label: "Lekki Gardens Estate: A1", href: `/sales/opportunities/${c.w1.id}` });
    expect((await drillRecords(w.repA, "deal", row.ids!)).map((r) => r.id).sort()).toEqual([c.w1.id, c.w2.id, c.l1.id].sort()); // repA is shown only their own three
    expect(await drillRecords(w.repB, "deal", [c.w1.id])).toEqual([]);
    const other = await world();
    expect(await drillRecords(other.admin, "deal", row.ids!)).toEqual([]);
    expect(await drillRecords(w.admin, "deal", Array.from({ length: 300 }, (_, i) => `nope${i}`))).toEqual([]);
  });
});

describe("the CSV", () => {
  it("has the labels and figures, is audited with the report and the period only, and neutralises a name that could run as a formula", async () => {
    const w = await world();
    const evil = await createAccount(w.repA, { name: "=HYPERLINK(\"http://evil.test\")" });
    const deal = await w.made(w.repA, evil, "Won evil", { stageId: w.stage("Won").id, wonAt: d("2026-09-01T10:00:00Z"), probability: 100, monthlyContractValue: "900000.00" });
    const f = await reportCsv(w.repA, "concentration", { from: "2026-09-01", to: "2026-09-30" }, { records: true });
    expect(f.fileName).toBe("sales-report-concentration-2026-09-01-to-2026-09-30.csv");
    const lines = f.csv.split("\r\n");
    expect(lines[0]).toBe("Clients,Count,Monthly value (naira),Share of total");
    expect(lines[1]).toBe("Top 5 clients,1,900000.00,100.0%");
    expect(f.csv).toContain("\"'=HYPERLINK("); // the account name does not run as a formula
    expect(f.csv).not.toMatch(/^=HYPERLINK/m);
    expect(f.csv).toContain("Row,Record,Link");
    expect(f.csv).toContain(`/sales/accounts/${evil.id}`);
    expect(deal.id).toBeTruthy();
    const audit = await db.auditLog.findMany({ where: { organizationId: w.t.org.id, action: "SALES_REPORT_EXPORT" } });
    expect(audit).toHaveLength(1);
    expect(audit[0].newValue).toEqual({ report: "concentration", from: "2026-09-01", to: "2026-09-30", records: true });
    expect(JSON.stringify(audit[0].newValue)).not.toContain("HYPERLINK");
    await expect(reportCsv(w.t.ctx("AUDITOR", null, 1), "pipeline")).rejects.toThrow(/permission/i);
  });
});

describe("the service dashboard", () => {
  it("counts cases opened and closed, and the SLA, breaches and reopen rate from real cases", async () => {
    const w = await world();
    await db.crmSlaPolicy.create({ data: { organizationId: w.t.org.id, accountKey: "", priority: "NORMAL", firstResponseMinutes: 60, resolutionMinutes: 120, businessHoursOnly: false, createdBy: "t" } });
    const mk = (subject: string) => createCase(w.repA, { accountId: w.accA.id, category: "STAFFING", priority: "NORMAL", subject });
    const a = await mk("Guard absent");
    const b = await mk("Late relief");
    await mk("Still open");
    await resolveCase(w.repA, a.id, "Fixed"); // resolved at once: both deadlines met
    await db.crmCase.update({ where: { id: b.id }, data: { firstResponseDueAt: new Date(Date.now() - 3_600_000), resolutionDueAt: new Date(Date.now() - 1_800_000) } }); // b is past both deadlines with no answer
    expect(cells(await widget(w.repA, "cases"))).toEqual([["STAFFING", 3, 1], ["All", 3, 1]]);
    expect(cells(await widget(w.repA, "sla"))).toEqual([["First response", 2, 1, "50.0%"], ["Resolution", 2, 1, "50.0%"]]); // a met, b missed; the third is still inside its window
    expect(cells(await widget(w.repA, "breaches"))).toEqual([["Account", "Lekki Gardens Estate", 1], ["Site", "No site named", 1]]);
    expect(cells(await widget(w.repA, "reopen"))).toEqual([[1, 0, "0.0%"]]);
    expect(cells(await widget(w.repB, "cases"))).toEqual([["All", 0, 0]]); // repB sees none of repA's cases
    expect(cells(await widget(w.admin, "cases"))[1]).toEqual(["All", 3, 1]);
  });
});

describe("the accounts dashboard", () => {
  it("counts accounts by health band and says plainly that rate reviews are not available yet", async () => {
    const w = await world();
    const client = await db.client.create({ data: { organizationId: w.t.org.id, code: "C1", name: "Lekki Gardens Estate" } });
    await db.crmAccount.update({ where: { id: w.accA.id }, data: { clientId: client.id } });
    await db.crmAccountHealth.create({ data: { organizationId: w.t.org.id, accountId: w.accA.id, score: 30, band: "AT_RISK", components: [{ key: "INVOICES_OVERDUE", label: "x", weight: 20, subScore: 0, detail: "The oldest unpaid invoice is 70 day(s) past due" }], computedAt: new Date() } });
    expect(cells(await widget(w.repA, "health"))).toEqual([["Healthy", 0, ""], ["Watch", 0, ""], ["At risk", 1, ""], ["Lekki Gardens Estate (30)", 1, "The oldest unpaid invoice is 70 day(s) past due"]]);
    expect(cells(await widget(w.repB, "health")).slice(0, 3)).toEqual([["Healthy", 0, ""], ["Watch", 0, ""], ["At risk", 0, ""]]);
    const rr = await widget(w.admin, "rate-reviews");
    expect(rr.rows).toEqual([]);
    expect(rr.note).toMatch(/not available yet/i);
  });
});

describe("the dashboards", () => {
  it("answer every widget for every view, and write nothing at all", async () => {
    const w = await world();
    await closedDeals(w);
    const counts = async () => ({ deals: await db.crmOpportunity.count({ where: { organizationId: w.t.org.id } }), cases: await db.crmCase.count({ where: { organizationId: w.t.org.id } }), tasks: await db.crmTask.count({ where: { organizationId: w.t.org.id } }), audit: await db.auditLog.count({ where: { organizationId: w.t.org.id } }), health: await db.crmAccountHealth.count({ where: { organizationId: w.t.org.id } }), notes: await db.crmNotification.count({ where: { organizationId: w.t.org.id } }) });
    const before = await counts();
    const all = [...(await dashboard(w.admin, "sales")), ...(await dashboard(w.admin, "accounts")), ...(await dashboard(w.admin, "service"))];
    expect(all.map((x) => x.key).sort()).toEqual([...WIDGET_KEYS].sort());
    expect(all.every((x) => typeof x.note === "string" && x.note.length > 10)).toBe(true); // each says what its date filter applies to
    expect(await counts()).toEqual(before);
  });
});
