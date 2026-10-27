import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StatutoryNotice } from "@/components/statutory-notice";
import type { RuleVerdict } from "@/lib/rule-verification";

/** The notice on the payroll page: what a person is told about the statutory rules, in each situation. */
const at = new Date("2026-10-20T09:00:00Z");
const ok = (kind: RuleVerdict["kind"], label: string): RuleVerdict => ({ kind, label, verified: true, reason: "Verified", signedBy: [{ slot: "HR", name: "Hauwa HR", at }, { slot: "FINANCE", name: "Femi Finance", at }] });
const bad = (kind: RuleVerdict["kind"], label: string, reason: string): RuleVerdict => ({ kind, label, verified: false, reason, signedBy: [] });

type Status = Parameters<typeof StatutoryNotice>[0]["status"];
const status = (over: Partial<Status>): Status => ({ period: { id: "p", name: "November 2026", endDate: at }, bureauClient: true, gated: true, verdicts: [], unverified: [], ...over });
const html = (s: Status) => renderToStaticMarkup(createElement(StatutoryNotice, { status: s }));

describe("the statutory rules notice", () => {
  it("says plainly that payroll is BLOCKED for a production client, naming each rule and why", () => {
    const u = [bad("TAX", "PAYE NTA v2026.1", "Never put through verification in the Statutory Rule Library."), bad("PENSION", "Pension v2026.1", "Changed since it was verified: the rule held no longer matches what HR and Finance signed.")];
    const out = html(status({ gated: true, verdicts: u, unverified: u }));
    expect(out).toContain("Payroll is blocked");
    expect(out).toContain('role="alert"');
    expect(out).toContain("PAYE NTA v2026.1");
    expect(out).toContain("Never put through verification");
    expect(out).toContain("Pension v2026.1");
    expect(out).toMatch(/can&#x27;t be calculated, submitted, approved or locked/);
    expect(out).toContain("border-red-200");
  });

  it("warns, but does not say blocked, for a client still being set up", () => {
    const u = [bad("TAX", "PAYE NTA v2026.1", "Waiting for HR and Finance (1 of 2 signed).")];
    const out = html(status({ gated: false, verdicts: u, unverified: u }));
    expect(out).toContain("has not been verified yet");
    expect(out).not.toContain("Payroll is blocked");
    expect(out).toContain("payroll is not stopped");
    expect(out).toContain("border-amber-200");
  });

  it("shows who verified each rule, and when, when everything is verified", () => {
    const v = [ok("TAX", "PAYE NTA v2026.1"), ok("PENSION", "Pension v2026.1"), ok("EMPLOYER_COST", "Employer contributions v2026.1")];
    const out = html(status({ gated: true, verdicts: v }));
    expect(out).toContain("Statutory rules verified");
    expect(out).toContain("Hauwa HR");
    expect(out).toContain("Femi Finance");
    expect(out).not.toContain("role=\"alert\"");
  });

  it("shows nothing for an organization that is not a bureau client", () => {
    expect(html(status({ bureauClient: false, gated: false }))).toBe("");
  });
});
