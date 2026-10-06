import { describe, expect, it } from "vitest";
import { neutralizeFormula, toCsv } from "@/server/services/reports";
import { reportPermission } from "@/lib/report-access";
import { REPORT_LINKS } from "@/lib/nav";
import { REPORT_TYPES } from "@/server/report-registry";

describe("neutralizeFormula", () => {
  it("defuses text a spreadsheet would run as a formula", () => {
    expect(neutralizeFormula('=HYPERLINK("http://evil.test","click")')).toBe(`'=HYPERLINK("http://evil.test","click")`);
    expect(neutralizeFormula("+cmd|' /C calc'!A0")).toBe("'+cmd|' /C calc'!A0");
    expect(neutralizeFormula("-2+3")).toBe("'-2+3");
    expect(neutralizeFormula("@SUM(A1:A9)")).toBe("'@SUM(A1:A9)");
    expect(neutralizeFormula("\t=1+1")).toBe("'\t=1+1");
    expect(neutralizeFormula("\r=1+1")).toBe("'\r=1+1");
  });
  it("leaves ordinary text and plain numbers alone", () => {
    expect(neutralizeFormula("Ada Okafor")).toBe("Ada Okafor");
    expect(neutralizeFormula("2026-10-06")).toBe("2026-10-06");
    expect(neutralizeFormula("-1200")).toBe("-1200");
    expect(neutralizeFormula("-1200.50")).toBe("-1200.50");
    expect(neutralizeFormula("=")).toBe("'=");
    expect(neutralizeFormula("")).toBe("");
    expect(neutralizeFormula("a=b")).toBe("a=b"); // only a *leading* character matters
  });
});

describe("toCsv", () => {
  const cols = [
    { key: "name", label: "Name" },
    { key: "amount", label: "Amount" },
  ];
  it("neutralises typed text but keeps numbers as numbers, including negatives", () => {
    const csv = toCsv([{ name: "=1+1", amount: -500.25 }, { name: "Ada", amount: 1200 }], cols);
    expect(csv.split("\n")).toEqual(["Name,Amount", "'=1+1,-500.25", "Ada,1200"]);
  });
  it("still quotes commas, quotes and line breaks, and neutralises first", () => {
    const csv = toCsv([{ name: '=SUM(1,2) "x"', amount: 1 }, { name: "line\nbreak", amount: 2 }, { name: "a\rb", amount: 3 }], cols);
    expect(csv).toContain(`"'=SUM(1,2) ""x"""`);
    expect(csv).toContain(`"line\nbreak"`);
    expect(csv).toContain(`"a\rb"`);
  });
  it("writes dates, nulls and an empty table sensibly", () => {
    expect(toCsv([{ name: new Date("2026-10-06T10:00:00Z"), amount: null }], cols)).toBe("Name,Amount\n2026-10-06,");
    expect(toCsv([], cols)).toBe("Name,Amount");
    expect(toCsv([])).toBe("");
  });
});

describe("reportPermission", () => {
  it("asks for the permission that guards the underlying records", () => {
    expect(reportPermission("audit")).toBe("audit.view");
    expect(reportPermission("appraisal-results")).toBe("appraisal.view");
    expect(reportPermission("guarantors")).toBe("employee.sensitive");
    expect(reportPermission("detail-changes")).toBe("employee.sensitive");
    expect(reportPermission("records-completeness")).toBe("employee.sensitive");
    expect(reportPermission("hr-headcount")).toBe("hr.view");
    expect(reportPermission("payroll-register")).toBe("reports.view");
    expect(reportPermission("something-unknown")).toBe("reports.view");
  });
  it("every report link in the hub points at a real report", () => {
    const slugs = REPORT_LINKS.filter((l) => l.href.startsWith("/reports/")).map((l) => l.href.replace("/reports/", ""));
    for (const s of slugs) expect(REPORT_TYPES as readonly string[]).toContain(s);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
  it("every HR report is in the hub", () => {
    const hub = REPORT_LINKS.map((l) => l.href.replace("/reports/", ""));
    for (const s of ["hr-headcount", "training-compliance", "policy-acknowledgements", "appraisal-results", "guarantors", "records-completeness", "detail-changes"]) expect(hub).toContain(s);
  });
});
