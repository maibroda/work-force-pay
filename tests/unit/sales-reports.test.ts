import { describe, expect, it } from "vitest";
import {
  activityWidget, breachesWidget, casesWidget, competitorsWidget, concentrationWidget, conversionWidget, cycleWidget, forecastWidget, funnelWidget, healthWidget, lostReasonsWidget, marginWidget, renewalsWidget, reopenWidget,
  slaWidget, sourceRevenueWidget, stageDaysWidget, weekOf, widgetCsv, winRateWidget, type CaseRow, type ClosedDeal, type HistoryRow, type OpenDeal, type StageRef,
} from "@/lib/sales/reports";

/**
 * One fixed synthetic dataset. Every expected figure below was worked out by hand and is written beside its test.
 */
const d = (s: string) => new Date(s);
const cells = (w: { rows: Array<{ cells: Array<string | number> }> }) => w.rows.map((r) => r.cells);

const stages: StageRef[] = [
  { id: "S1", name: "Lead in", sortOrder: 1, stageType: "OPEN" },
  { id: "S2", name: "Qualified", sortOrder: 2, stageType: "OPEN" },
  { id: "S3", name: "Proposal sent", sortOrder: 3, stageType: "OPEN" },
  { id: "S4", name: "Won", sortOrder: 4, stageType: "WON" },
  { id: "S5", name: "Lost", sortOrder: 5, stageType: "LOST" },
];

const open: OpenDeal[] = [
  { id: "d1", stageId: "S1", monthlyContractValue: "1000000.00", probability: 10, expectedCloseDate: d("2026-11-15") },
  { id: "d2", stageId: "S1", monthlyContractValue: "500000.50", probability: 10, expectedCloseDate: d("2026-11-20") },
  { id: "d3", stageId: "S2", monthlyContractValue: "2000000.00", probability: 20, expectedCloseDate: d("2026-12-05") },
  { id: "d4", stageId: "S3", monthlyContractValue: "3000000.00", probability: 50, expectedCloseDate: null },
];

const closed: ClosedDeal[] = [
  { id: "w1", outcome: "WON", at: d("2026-08-10T10:00:00Z"), createdAt: d("2026-07-01T10:00:00Z"), ownerName: "Ada", source: "REFERRAL", serviceType: "GUARDING", lostReason: null, competitor: null, monthlyContractValue: "1200000.00" },
  { id: "w2", outcome: "WON", at: d("2026-08-20T10:00:00Z"), createdAt: d("2026-07-21T10:00:00Z"), ownerName: "Ada", source: "TENDER", serviceType: "GUARDING", lostReason: null, competitor: "SecureCo", monthlyContractValue: "800000.00" },
  { id: "w3", outcome: "WON", at: d("2026-09-05T10:00:00Z"), createdAt: d("2026-08-06T10:00:00Z"), ownerName: "Bola", source: "REFERRAL", serviceType: "CLEANING", lostReason: null, competitor: null, monthlyContractValue: "500000.00" },
  { id: "l1", outcome: "LOST", at: d("2026-08-15T10:00:00Z"), createdAt: d("2026-07-15T10:00:00Z"), ownerName: "Ada", source: "TENDER", serviceType: "GUARDING", lostReason: "PRICE", competitor: "SecureCo", monthlyContractValue: "400000.00" },
  { id: "l2", outcome: "LOST", at: d("2026-09-10T10:00:00Z"), createdAt: d("2026-08-10T10:00:00Z"), ownerName: "Bola", source: "REFERRAL", serviceType: "CLEANING", lostReason: "PRICE", competitor: "SecureCo", monthlyContractValue: "300000.00" },
  { id: "l3", outcome: "LOST", at: d("2026-09-12T10:00:00Z"), createdAt: d("2026-08-12T10:00:00Z"), ownerName: "Bola", source: "WEBSITE", serviceType: "STAFFING", lostReason: "NO_DECISION", competitor: null, monthlyContractValue: "200000.00" },
];

// deal A: made in Lead in; Lead in to Qualified after 10 days; Qualified to Proposal after 20; Proposal to Won after 5
// deal B: made in Lead in; to Qualified after 4 days; Qualified to Lost after 6
// deal C: made in Lead in; Lead in straight to Proposal sent after 8 days (skips Qualified), and is still there
const history: HistoryRow[] = [
  { opportunityId: "A", fromStageId: null, toStageId: "S1", daysInPreviousStage: null, seq: 1 },
  { opportunityId: "A", fromStageId: "S1", toStageId: "S2", daysInPreviousStage: 10, seq: 4 },
  { opportunityId: "A", fromStageId: "S2", toStageId: "S3", daysInPreviousStage: 20, seq: 7 },
  { opportunityId: "A", fromStageId: "S3", toStageId: "S4", daysInPreviousStage: 5, seq: 9 },
  { opportunityId: "B", fromStageId: null, toStageId: "S1", daysInPreviousStage: null, seq: 2 },
  { opportunityId: "B", fromStageId: "S1", toStageId: "S2", daysInPreviousStage: 4, seq: 5 },
  { opportunityId: "B", fromStageId: "S2", toStageId: "S5", daysInPreviousStage: 6, seq: 8 },
  { opportunityId: "C", fromStageId: null, toStageId: "S1", daysInPreviousStage: null, seq: 3 },
  { opportunityId: "C", fromStageId: "S1", toStageId: "S3", daysInPreviousStage: 8, seq: 6 },
];

describe("open pipeline and forecast", () => {
  it("counts and adds open deals by stage, with weighted values rounded once for each deal, in the stage order", () => {
    const w = funnelWidget(open, stages);
    // Lead in: 2 deals, 1,000,000.00 + 500,000.50 = 1,500,000.50; weighted 10% of each: 100,000.00 + 50,000.05 = 150,000.05
    // Qualified: 1 deal, 2,000,000.00; 20% = 400,000.00.  Proposal sent: 1 deal, 3,000,000.00; 50% = 1,500,000.00
    expect(cells(w)).toEqual([
      ["Lead in", 2, "1500000.50", "150000.05"],
      ["Qualified", 1, "2000000.00", "400000.00"],
      ["Proposal sent", 1, "3000000.00", "1500000.00"],
      ["All open deals", 4, "6500000.50", "2050000.05"],
    ]);
    expect(w.rows[0].ids).toEqual(["d1", "d2"]);
    expect(w.rows[3].ids).toEqual(["d1", "d2", "d3", "d4"]);
    expect(w.columns.map((c) => c.kind)).toEqual(["text", "count", "money", "money"]);
  });

  it("groups the weighted forecast by expected close month, deals with no date last", () => {
    expect(cells(forecastWidget(open))).toEqual([
      ["2026-11", 2, "1500000.50", "150000.05"],
      ["2026-12", 1, "2000000.00", "400000.00"],
      ["No close date", 1, "3000000.00", "1500000.00"],
    ]);
  });
});

describe("win rate", () => {
  it("is won over won plus lost, overall and by month, owner, source and service; a group with no closed deals has no rate", () => {
    const w = winRateWidget(closed);
    const row = (view: string, group: string) => cells(w).find((c) => c[0] === view && c[1] === group);
    expect(row("Overall", "All deals")).toEqual(["Overall", "All deals", 3, 3, "50.0%"]); // 3 of 6
    expect(row("Month", "2026-08")).toEqual(["Month", "2026-08", 2, 1, "66.7%"]); // w1, w2 won; l1 lost
    expect(row("Month", "2026-09")).toEqual(["Month", "2026-09", 1, 2, "33.3%"]); // w3 won; l2, l3 lost
    expect(row("Owner", "Ada")).toEqual(["Owner", "Ada", 2, 1, "66.7%"]);
    expect(row("Owner", "Bola")).toEqual(["Owner", "Bola", 1, 2, "33.3%"]);
    expect(row("Source", "REFERRAL")).toEqual(["Source", "REFERRAL", 2, 1, "66.7%"]);
    expect(row("Source", "TENDER")).toEqual(["Source", "TENDER", 1, 1, "50.0%"]);
    expect(row("Source", "WEBSITE")).toEqual(["Source", "WEBSITE", 0, 1, "0.0%"]);
    expect(row("Service", "GUARDING")).toEqual(["Service", "GUARDING", 2, 1, "66.7%"]);
    expect(row("Service", "CLEANING")).toEqual(["Service", "CLEANING", 1, 1, "50.0%"]);
    expect(row("Service", "STAFFING")).toEqual(["Service", "STAFFING", 0, 1, "0.0%"]);
    expect(w.rows.find((r) => r.cells[1] === "Ada")!.ids!.sort()).toEqual(["l1", "w1", "w2"]);
    expect(cells(winRateWidget([]))).toEqual([["Overall", "All deals", 0, 0, "—"]]);
    expect(cells(winRateWidget([closed[0]]))[0]).toEqual(["Overall", "All deals", 1, 0, "100.0%"]);
  });
});

describe("sales cycle and time in stage", () => {
  it("averages the days from made to won: 40, 30 and 30 days is 33.3 on average", () => {
    // w1: 1 July to 10 August is 40 days; w2: 21 July to 20 August is 30; w3: 6 August to 5 September is 30
    expect(cells(cycleWidget(closed))).toEqual([[3, "33.3", 30, 40]]);
    expect(cells(cycleWidget([]))).toEqual([[0, "—", "—", "—"]]);
  });

  it("averages how long deals stayed in each stage before leaving it", () => {
    // Lead in: 10, 4 and 8 days (22 / 3 = 7.3); Qualified: 20 and 6 (13.0); Proposal sent: 5 (5.0); the stages a deal ended in have no "left" figure
    expect(cells(stageDaysWidget(history, stages))).toEqual([["Lead in", 3, "7.3"], ["Qualified", 2, "13.0"], ["Proposal sent", 1, "5.0"]]);
  });

  it("says, of the deals that reached a stage, how many later advanced to a later open stage or to won (losing is not advancing; skipping a stage still counts)", () => {
    // Lead in: A, B, C reached it; all three advanced (A and B to Qualified, C to Proposal sent): 3 of 3
    // Qualified: A and B reached it; A advanced to Proposal sent, B was lost: 1 of 2
    // Proposal sent: A and C reached it; A advanced to Won, C is still there: 1 of 2
    expect(cells(conversionWidget(history, stages))).toEqual([["Lead in", 3, 3, "100.0%"], ["Qualified", 2, 1, "50.0%"], ["Proposal sent", 2, 1, "50.0%"]]);
  });
});

describe("why deals are lost, and against whom", () => {
  it("shares out the reasons, and counts wins and losses against each competitor named", () => {
    expect(cells(lostReasonsWidget(closed))).toEqual([["PRICE", 2, "66.7%"], ["NO_DECISION", 1, "33.3%"]]);
    expect(cells(competitorsWidget(closed))).toEqual([["SecureCo", 1, 2, "33.3%"]]); // won w2; lost l1 and l2
  });
});

describe("activity by person and week", () => {
  const acts = [
    { id: "a1", userName: "Ada", kind: "CALL", at: d("2026-10-27T09:00:00Z") },
    { id: "a2", userName: "Ada", kind: "CALL", at: d("2026-10-28T09:00:00Z") },
    { id: "a3", userName: "Ada", kind: "MEETING", at: d("2026-10-30T09:00:00Z") },
    { id: "a4", userName: "Bola", kind: "SITE_SURVEY", at: d("2026-10-29T09:00:00Z") },
    { id: "a5", userName: "Ada", kind: "CALL", at: d("2026-11-02T08:00:00Z") },
    { id: "a6", userName: "Ada", kind: "CALL", at: d("2026-11-01T23:30:00Z") }, // 00:30 on Monday 2 November in Lagos: the new week
    { id: "a7", userName: "Bola", kind: "CALL", at: d("2026-11-01T22:30:00Z") }, // 23:30 on Sunday 1 November in Lagos: the old week
    { id: "a8", userName: "Ada", kind: "NOTE", at: d("2026-10-27T10:00:00Z") }, // a note is not counted
  ];
  it("finds the Monday of the Lagos week", () => {
    expect(weekOf(d("2026-11-01T22:30:00Z"))).toBe("2026-10-26");
    expect(weekOf(d("2026-11-01T23:30:00Z"))).toBe("2026-11-02");
    expect(weekOf(d("2026-10-26T00:00:00+01:00"))).toBe("2026-10-26");
  });
  it("counts calls, meetings and site surveys for each person in each week", () => {
    expect(cells(activityWidget(acts))).toEqual([["2026-10-26", "Ada", 2, 1, 0], ["2026-10-26", "Bola", 1, 0, 1], ["2026-11-02", "Ada", 2, 0, 0]]);
    expect(activityWidget(acts).rows[0].ids).toEqual(["a1", "a2", "a3"]);
  });
});

describe("source to revenue", () => {
  it("adds the monthly value won by lead source", () => {
    // REFERRAL: w1 1,200,000.00 + w3 500,000.00 = 1,700,000.00 over 2 deals; TENDER: w2 800,000.00
    expect(cells(sourceRevenueWidget(closed))).toEqual([["REFERRAL", 2, "1700000.00"], ["TENDER", 1, "800000.00"], ["All sources", 3, "2500000.00"]]);
  });
});

describe("quote margins", () => {
  const quotes = [
    { id: "q1", marginBps: 905, belowMinimum: true, belowMarginApproved: true },
    { id: "q2", marginBps: 1240, belowMinimum: true, belowMarginApproved: false },
    { id: "q3", marginBps: 1500, belowMinimum: false, belowMarginApproved: false },
    { id: "q4", marginBps: 1999, belowMinimum: false, belowMarginApproved: false },
    { id: "q5", marginBps: 2000, belowMinimum: false, belowMarginApproved: false },
    { id: "q6", marginBps: -50, belowMinimum: true, belowMarginApproved: true },
    { id: "q7", marginBps: 100, belowMinimum: true, belowMarginApproved: false },
  ];
  it("puts each quote in a margin band (the lower edge belongs to the band) and counts those below the minimum and those approved", () => {
    expect(cells(marginWidget(quotes))).toEqual([
      ["Below 0%", 1], ["0% to under 5%", 1], ["5% to under 10%", 1], ["10% to under 15%", 1], ["15% to under 20%", 2], ["20% and over", 1],
      ["Below the minimum margin", 4], ["of which approved by a designated approver", 2],
    ]);
    expect(marginWidget(quotes).rows[4].ids).toEqual(["q3", "q4"]);
    expect(marginWidget(quotes).rows[7].ids).toEqual(["q1", "q6"]);
  });
});

describe("account health, renewals and concentration", () => {
  it("counts accounts by band and lists the at-risk ones, weakest first, with their weakest measure as the reason", () => {
    const comp = (subs: Array<[string, number | null, string]>) => subs.map(([key, subScore, detail]) => ({ key, label: key, weight: 10, subScore, detail }));
    const rows = [
      { accountId: "A", name: "Alpha", score: 85, band: "HEALTHY" as const, components: comp([["SLA_BREACHES", 100, "none"]]) },
      { accountId: "B", name: "Bravo", score: 55, band: "WATCH" as const, components: comp([["SLA_BREACHES", 50, "2 missed"]]) },
      { accountId: "C", name: "Charlie", score: 30, band: "AT_RISK" as const, components: comp([["SLA_BREACHES", 75, "1 missed"], ["INVOICES_OVERDUE", 0, "oldest invoice 70 days past due"], ["CLIENT_CONTACT", 20, "110 days since contact"]]) },
      { accountId: "D", name: "Delta", score: 10, band: "AT_RISK" as const, components: comp([["SLA_BREACHES", 0, "4 missed deadlines"], ["INVOICES_OVERDUE", 0, "also zero"]]) },
    ];
    const w = healthWidget(rows);
    expect(cells(w)).toEqual([["Healthy", 1, ""], ["Watch", 1, ""], ["At risk", 2, ""], ["Delta (10)", 1, "4 missed deadlines"], ["Charlie (30)", 1, "oldest invoice 70 days past due"]]);
    expect(w.rows[3].ids).toEqual(["D"]);
  });

  it("groups contracts ending in the next 90 days into 30, 60 and 90 and says where each renewal stands", () => {
    const k = (id: string, end: string, renewal: string | null) => ({ id, name: `Contract ${id}`, accountName: "Acct", endDate: d(end), renewal });
    const w = renewalsWidget(
      [k("k1", "2026-11-15", null), k("k2", "2026-12-10", "In progress: Proposal sent"), k("k3", "2027-01-10", "Not renewed (lost)"), k("k4", "2027-01-29", null), k("k5", "2026-11-29", "Renewed"), k("k6", "2026-10-29", null)],
      d("2026-10-30"),
    );
    // days from 30 October: k1 16, k5 30, k2 41, k3 72, k4 91 (outside), k6 -1 (already ended, outside)
    expect(cells(w)).toEqual([
      ["Within 30 days", 2, 1, 0, 1, 0],
      ["31 to 60 days", 1, 0, 1, 0, 0],
      ["61 to 90 days", 1, 0, 0, 0, 1],
    ]);
    expect(w.rows[0].ids).toEqual(["k1", "k5"]);
  });

  it("shares the total won monthly value held by the top 5 and top 10 clients", () => {
    const rows = [["A", 5_000_000], ["B", 3_000_000], ["C", 1_000_000], ["D", 500_000], ["E", 500_000], ["F", 300_000], ["G", 200_000]].map(([id, v]) => ({ accountId: id as string, name: `Client ${id}`, monthlyContractValue: (v as number).toFixed(2) }));
    const w = concentrationWidget(rows);
    // total 10,500,000.00; top 5 = 10,000,000.00 = 95.2%; only 7 clients, so the top 10 is all of it: 100.0%
    expect(cells(w).slice(0, 3)).toEqual([["Top 5 clients", 5, "10000000.00", "95.2%"], ["Top 10 clients", 7, "10500000.00", "100.0%"], ["All clients", 7, "10500000.00", "100.0%"]]);
    expect(cells(w)[3]).toEqual(["1. Client A", 1, "5000000.00", "47.6%"]);
    expect(cells(concentrationWidget([]))).toEqual([["Top 5 clients", 0, "0.00", "—"], ["Top 10 clients", 0, "0.00", "—"], ["All clients", 0, "0.00", "—"]]);
  });
});

describe("cases and service levels", () => {
  const NOW = d("2026-10-30T10:00:00Z");
  const c = (id: string, over: Partial<CaseRow>): CaseRow => ({ id, category: "STAFFING", accountId: "A", accountName: "Alpha", siteName: null, openedAt: d("2026-10-01T08:00:00Z"), firstResponseDueAt: null, firstResponseWarnAt: null, firstRespondedAt: null, resolutionDueAt: null, resolutionWarnAt: null, resolvedAt: null, reopenedCount: 0, ...over });
  const cases: CaseRow[] = [
    c("c1", { siteName: "Gate 1", firstResponseDueAt: d("2026-10-01T12:00:00Z"), firstRespondedAt: d("2026-10-01T11:00:00Z"), resolutionDueAt: d("2026-10-03T12:00:00Z"), resolvedAt: d("2026-10-03T10:00:00Z") }), // both met
    c("c2", { siteName: "Gate 1", openedAt: d("2026-10-05T08:00:00Z"), firstResponseDueAt: d("2026-10-05T12:00:00Z"), firstRespondedAt: d("2026-10-05T13:00:00Z"), resolutionDueAt: d("2026-10-07T12:00:00Z"), resolvedAt: d("2026-10-08T10:00:00Z"), reopenedCount: 1 }), // both late
    c("c3", { category: "SERVICE_QUALITY", accountId: "B", accountName: "Bravo", siteName: "Main", openedAt: d("2026-10-10T08:00:00Z"), firstResponseDueAt: d("2026-10-10T12:00:00Z"), firstRespondedAt: d("2026-10-10T09:00:00Z"), resolutionDueAt: d("2026-10-12T12:00:00Z"), resolvedAt: d("2026-10-12T11:00:00Z") }), // both met
    c("c4", { category: "BILLING", accountId: "B", accountName: "Bravo", openedAt: d("2026-10-15T08:00:00Z"), firstResponseDueAt: d("2026-10-15T12:00:00Z"), resolutionDueAt: d("2026-10-17T12:00:00Z") }), // never answered, never resolved: both missed
    c("c5", { category: "BILLING", accountId: "B", accountName: "Bravo", openedAt: d("2026-10-20T08:00:00Z"), firstRespondedAt: d("2026-10-20T09:00:00Z"), resolvedAt: d("2026-10-21T09:00:00Z") }), // no SLA policy
    c("c6", { category: "COMPLAINT", openedAt: d("2026-10-29T08:00:00Z"), firstResponseDueAt: d("2026-11-05T12:00:00Z") }), // still inside its window
  ];
  it("counts cases opened and closed by category", () => {
    expect(cells(casesWidget(cases, cases.filter((x) => x.resolvedAt)))).toEqual([["BILLING", 2, 1], ["COMPLAINT", 1, 0], ["SERVICE_QUALITY", 1, 1], ["STAFFING", 2, 2], ["All", 6, 4]]);
  });
  it("gives the share of deadlines met among those that have fallen due or been met: a case still inside its window and a case with no policy are left out", () => {
    // first response: c1 met, c2 late, c3 met, c4 missed (4 counted, 2 met = 50.0%); resolution the same
    expect(cells(slaWidget(cases, NOW))).toEqual([["First response", 4, 2, "50.0%"], ["Resolution", 4, 2, "50.0%"]]);
    expect(slaWidget(cases, NOW).rows[0].ids).toEqual(["c1", "c2", "c3", "c4"]);
  });
  it("counts breaches once for each case, by account and by site", () => {
    // c2 (late) is Alpha at Gate 1; c4 (missed) is Bravo with no site
    expect(cells(breachesWidget(cases, NOW))).toEqual([["Account", "Alpha", 1], ["Account", "Bravo", 1], ["Site", "Gate 1", 1], ["Site", "No site named", 1]]);
  });
  it("gives the reopen rate: cases reopened over cases ever resolved", () => {
    // resolved: c1, c2, c3, c5 (4); reopened: c2 (1) = 25.0%
    expect(cells(reopenWidget(cases))).toEqual([[4, 1, "25.0%"]]);
    expect(cells(reopenWidget([]))).toEqual([[0, 0, "—"]]);
  });
});

describe("the CSV", () => {
  it("has the column labels and the figures, and a cell that could run as a spreadsheet formula is neutralised", () => {
    const w = funnelWidget([{ ...open[0], id: "x" }], [{ id: "S1", name: "=HYPERLINK(\"http://evil.test\")", sortOrder: 1, stageType: "OPEN" }]);
    const csv = widgetCsv(w).split("\r\n");
    expect(csv[0]).toBe("Stage,Deals,Monthly value (naira),Weighted value (naira)");
    expect(csv[1].startsWith("\"'=HYPERLINK(")).toBe(true);
    expect(csv[2]).toBe("All open deals,1,1000000.00,100000.00");
  });
});
