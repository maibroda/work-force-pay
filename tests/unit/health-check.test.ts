import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { AREAS, AREA_LABELS, blockers, DISCLAIMER, RESPONSES, summarise, TEMPLATE, type FindingFacts, type ItemFacts, type Response } from "@/lib/health-check";
import { summaryLines, summaryPdf, type SummaryDoc } from "@/lib/health-check-pdf";
import { findForbiddenClaims } from "@/lib/pricing";

const items = (over: Partial<Record<string, Response>> = {}, evidence = "Saw the last two months' input emails"): ItemFacts[] =>
  TEMPLATE.map((t) => ({ code: t.code, area: t.area, question: t.question, response: over[t.code] ?? "IN_PLACE", evidence: (over[t.code] ?? "IN_PLACE") === "NOT_ASSESSED" ? null : evidence, note: "Not part of this business" }));
const finding = (n: number, over: Partial<FindingFacts> = {}): FindingFacts => ({ number: n, itemCode: "IN-01", area: "INPUTS_APPROVALS", title: `Finding number ${n} title`, severity: "MEDIUM", recommendation: "Do the sensible thing about it, and write down that you did.", ...over });

describe("the checklist", () => {
  it("covers the five areas in the spec, each with several controls, with unique codes", () => {
    expect(AREAS).toHaveLength(5);
    expect(Object.values(AREA_LABELS)).toEqual(["Input and approval controls", "Calculations and reconciliations", "Employee records and changes", "Statutory schedules", "Reporting and audit trails"]);
    for (const a of AREAS) expect(TEMPLATE.filter((t) => t.area === a).length, a).toBeGreaterThanOrEqual(4);
    expect(new Set(TEMPLATE.map((t) => t.code)).size).toBe(TEMPLATE.length);
    for (const t of TEMPLATE) {
      expect(t.code).toMatch(/^[A-Z]{2}-\d{2}$/);
      expect(t.guidance.length, t.code).toBeGreaterThan(20);
      expect(t.question.length, t.code).toBeGreaterThan(30);
    }
  });
  it("describes controls to be seen, and never promises a result", () => {
    for (const t of TEMPLATE) expect(findForbiddenClaims(`${t.question} ${t.guidance}`), t.code).toEqual([]);
    // the disclaimer names what the summary is not (an audit, a certification, an assurance of no errors), so it is the one text that mentions them
    expect(DISCLAIMER).toContain("Detailed reviews are separately scoped");
    expect(DISCLAIMER).toContain("not an audit, a certification of compliance, or an assurance that no errors exist");
  });
});

describe("what must be put right before a check can go for review", () => {
  it("is nothing when every control is assessed and every gap has a finding", () => {
    expect(blockers(items(), [])).toEqual([]);
    expect(blockers(items({ "IN-02": "NOT_SEEN", "CA-01": "PARTLY" }), [finding(1, { itemCode: "IN-02" }), finding(2, { itemCode: "CA-01" })])).toEqual([]);
  });
  it("lists controls not yet assessed", () => {
    const b = blockers(items({ "IN-01": "NOT_ASSESSED", "IN-02": "NOT_ASSESSED" }), []);
    expect(b).toEqual(["2 control(s) have not been assessed yet: IN-01, IN-02."]);
    expect(blockers(items(Object.fromEntries(TEMPLATE.slice(0, 9).map((t) => [t.code, "NOT_ASSESSED" as Response]))), [])[0]).toMatch(/9 control\(s\).*, …\./);
  });
  it("won't let a gap go unreported", () => {
    expect(blockers(items({ "RC-02": "NOT_SEEN" }), [])).toEqual(["RC-02 is a gap with no finding recorded against it."]);
    expect(blockers(items({ "RC-02": "PARTLY" }), [finding(1, { itemCode: "ST-01" })])).toEqual(["RC-02 is a gap with no finding recorded against it."]);
    expect(blockers(items({ "RC-02": "PARTLY" }), [finding(1, { itemCode: "RC-02" })])).toEqual([]);
  });
  it("needs real evidence for a control seen, and a reason for one that does not apply", () => {
    expect(blockers(items({}, "ok"), [])).toHaveLength(TEMPLATE.length);
    expect(blockers(items({ "ST-03": "NOT_APPLICABLE" }), [])).toEqual([]);
    const na = items({ "ST-03": "NOT_APPLICABLE" }).map((i) => (i.code === "ST-03" ? { ...i, note: "" } : i));
    expect(blockers(na, [])).toEqual(["ST-03 is marked as not applying without saying why."]);
  });
});

describe("the summary figures", () => {
  const its = items({ "IN-01": "PARTLY", "IN-02": "NOT_SEEN", "CA-01": "NOT_SEEN", "ST-03": "NOT_APPLICABLE" });
  const fs: FindingFacts[] = [finding(1, { severity: "LOW" }), finding(2, { severity: "HIGH", itemCode: "CA-01" }), finding(3, { severity: "MEDIUM" }), finding(4, { severity: "HIGH", itemCode: "IN-02" })];
  it("counts what was seen by area and in all", () => {
    const s = summarise(its, fs);
    const inputs = s.areas.find((a) => a.area === "INPUTS_APPROVALS")!;
    expect(inputs).toMatchObject({ total: 5, inPlace: 3, partly: 1, notSeen: 1, notApplicable: 0 });
    expect(s.totals).toMatchObject({ total: TEMPLATE.length, partly: 1, notSeen: 2, notApplicable: 1, notAssessed: 0, inPlace: TEMPLATE.length - 4 });
  });
  it("orders findings most serious first, then as recorded, and counts them by severity", () => {
    const s = summarise(its, fs);
    expect(s.ordered.map((f) => f.number)).toEqual([2, 4, 3, 1]);
    expect(s.bySeverity).toEqual([{ severity: "HIGH", count: 2 }, { severity: "MEDIUM", count: 1 }, { severity: "LOW", count: 1 }, { severity: "OBSERVATION", count: 0 }]);
  });
  it("knows the responses it offers", () => {
    expect(RESPONSES).toEqual(["NOT_ASSESSED", "IN_PLACE", "PARTLY", "NOT_SEEN", "NOT_APPLICABLE"]);
  });
});

describe("the one-page summary", () => {
  const base: SummaryDoc = {
    bureauName: "ThreeRoots Payroll Services", number: "HC-00001", company: "Guardian Shield Security", contact: "Col. Ibrahim Musa", title: "Payroll Health Check", issuedOn: "26 October 2026", conductedOn: "20 October 2026",
    periodReviewed: "July to September 2026", employeesInScope: 120, scopeNote: "Walkthrough of the payroll process and a sample of three employees.", assessedBy: "Ngozi Payroll Officer", reviewedBy: "Femi Payroll Reviewer",
    headline: "Approvals and remittances are in place; changes to bank details are not independently approved.", items: items({ "RC-02": "NOT_SEEN", "IN-04": "PARTLY" }), findings: [finding(1, { itemCode: "RC-02", severity: "HIGH", title: "Bank detail changes are not approved by a second person" }), finding(2, { itemCode: "IN-04", severity: "MEDIUM" })], draft: false,
  };
  const pages = async (d: SummaryDoc) => (await PDFDocument.load((await summaryPdf(d)).bytes)).getPageCount();

  it("says what was seen, the findings with recommendations, and the disclaimer", () => {
    const t = summaryLines(base).join("\n");
    expect(t).toContain("Guardian Shield Security | HC-00001");
    expect(t).toContain("seen in place 23 | seen in part 1 | not seen 1");
    expect(t).toContain("High: Bank detail changes are not approved by a second person | Do the sensible thing");
    expect(t).toContain(DISCLAIMER);
    // apart from the disclaimer, it makes no claim of compliance or accuracy
    expect(findForbiddenClaims(t.replace(DISCLAIMER, ""))).toEqual([]);
  });
  it("is one page, and tells the reader how much it fits", async () => {
    const r = await summaryPdf(base);
    expect(Buffer.from(r.bytes.subarray(0, 4)).toString()).toBe("%PDF");
    expect(r).toMatchObject({ shown: 2, total: 2 });
    expect(await pages(base)).toBe(1);
  });
  it("stays on one page however many and however long the findings are, and counts what it left out", async () => {
    const long = "Words that go on for a good while so that this wraps onto several lines of the page when it is drawn. ".repeat(6);
    const many: SummaryDoc = {
      ...base, scopeNote: long, headline: long,
      findings: Array.from({ length: 40 }, (_, i) => finding(i + 1, { severity: i < 5 ? "HIGH" : i < 15 ? "MEDIUM" : "LOW", title: `Finding ${i + 1}: ${long.slice(0, 120)}`, recommendation: long })),
    };
    const r = await summaryPdf(many);
    expect(await pages(many)).toBe(1);
    expect(r.total).toBe(40);
    expect(r.shown).toBeGreaterThan(0);
    expect(r.shown).toBeLessThan(40);
  });
  it("shows the most serious findings first when it can't show them all", async () => {
    const many: SummaryDoc = { ...base, findings: Array.from({ length: 30 }, (_, i) => finding(i + 1, { severity: i === 29 ? "HIGH" : "LOW", title: `Finding ${i + 1} with a title of reasonable length` })) };
    const r = await summaryPdf(many);
    expect(r.shown).toBeLessThan(30);
    expect(summaryLines(many).findIndex((l) => l.startsWith("High:"))).toBeLessThan(summaryLines(many).findIndex((l) => l.startsWith("Low:")));
  });
  it("handles no findings, a draft stamp, and accents or a naira sign in names", async () => {
    const none = await summaryPdf({ ...base, findings: [], items: items() });
    expect(none).toMatchObject({ shown: 0, total: 0 });
    expect(summaryLines({ ...base, draft: true })[0]).toBe("DRAFT: not yet reviewed or issued.");
    const odd = await summaryPdf({ ...base, company: "Ọlá & Sons (₦ group)", contact: "Mrs Nkechi Eze" });
    expect(odd.bytes.length).toBeGreaterThan(1000);
  });
});
