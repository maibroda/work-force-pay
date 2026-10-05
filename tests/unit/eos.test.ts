import { describe, expect, it } from "vitest";
import { d } from "@/lib/dates";
import { computeSettlementLines, serviceTenure, settlementTotals, type EosInput, type EosPolicy } from "@/lib/eos";

const policy: EosPolicy = {
  dailyRateDivisor: 30,
  leaveEncashmentEnabled: true,
  leaveEncashmentBasis: "GROSS",
  leaveEncashmentRespectsEligibility: true,
  leaveEncashmentMaxDays: null,
  leaveEncashmentTaxable: true,
  leaveEncashmentExitTypes: ["RESIGNATION", "TERMINATION", "END_OF_CONTRACT", "RETIREMENT", "DECEASED"],
  gratuityEnabled: false,
  gratuityBasis: "BASIC",
  gratuityMinYears: 5,
  gratuityDaysPerYear: 15,
  gratuityPartialYears: false,
  gratuityTaxable: true,
  gratuityExitTypes: ["RESIGNATION", "END_OF_CONTRACT", "RETIREMENT", "DECEASED"],
  severanceEnabled: false,
  severanceDaysPerYear: 15,
  severanceTaxable: true,
  noticePayEnabled: true,
  noticeRecoveryEnabled: true,
  noticePayTaxable: true,
};

const base: EosInput = {
  exitType: "RESIGNATION",
  reasonCategory: null,
  summaryDismissal: false,
  employmentDate: d("2024-01-01"),
  noticeDate: d("2026-05-31"),
  lastWorkingDate: d("2026-06-30"),
  noticeRequiredDays: 30,
  monthlyGross: 300_000,
  basicShare: 0.5,
  annualLeaveDays: 10,
  leaveEligibilityMonths: 12,
  approvedLeave: [],
};
const run = (over: Partial<EosInput> = {}, pol: Partial<EosPolicy> = {}) =>
  computeSettlementLines({ ...base, ...over }, { ...policy, ...pol });
const line = (r: ReturnType<typeof run>, code: string) => r.lines.find((l) => l.code === code);

describe("serviceTenure", () => {
  it("counts the last working day as worked, so a clean calendar span is whole years", () => {
    const t = serviceTenure(d("2020-01-01"), d("2024-12-31"));
    expect(t.completedYears).toBe(5);
    expect(t.serviceYears).toBe(5);
    expect(t.serviceDays).toBe(1827);
  });

  it("is one day short of a year the day before the anniversary", () => {
    expect(serviceTenure(d("2025-03-15"), d("2026-03-13")).completedYears).toBe(0);
    expect(serviceTenure(d("2025-03-15"), d("2026-03-14")).completedYears).toBe(1);
  });

  it("reports a fractional figure for the part-year", () => {
    const t = serviceTenure(d("2024-01-01"), d("2026-06-30"));
    expect(t.completedYears).toBe(2);
    expect(t.serviceYears).toBeGreaterThan(2.45);
    expect(t.serviceYears).toBeLessThan(2.55);
  });
});

describe("leave encashment", () => {
  it("pays what is left of the current entitlement plus what has accrued toward the next", () => {
    // Leave years run from each anniversary of the first entitlement (1 Jan 2025): year 2 began
    // 1 Jan 2026. 4 of 10 days used → 6 left; 181/365 of the next 10 has accrued (4.96).
    const r = run({ approvedLeave: [{ cycleStart: d("2026-01-01"), workingDays: 4 }] });
    expect(r.leaveTakenDays).toBe(4);
    expect(r.leavePayableDays).toBe(10.96);
    expect(line(r, "LEAVE_ENCASHMENT")!.amount).toBe(109_600); // 10.96 × 300,000 / 30
  });

  it("ignores leave charged to an earlier leave year", () => {
    const r = run({ approvedLeave: [{ cycleStart: d("2025-01-01"), workingDays: 10 }] });
    expect(r.leaveTakenDays).toBe(0);
    expect(r.leavePayableDays).toBeGreaterThan(14);
  });

  it("pays nothing before the first entitlement is due when the policy respects eligibility", () => {
    const r = run({ employmentDate: d("2026-03-01"), lastWorkingDate: d("2026-08-31") });
    expect(r.lines).toHaveLength(0);
    expect(r.notes.join(" ")).toMatch(/No leave was due yet/);
  });

  it("pro-rates the entitlement when eligibility is not respected", () => {
    const r = run(
      { employmentDate: d("2026-03-01"), lastWorkingDate: d("2026-08-31"), noticeDate: d("2026-08-01") },
      { leaveEncashmentRespectsEligibility: false },
    );
    expect(r.leavePayableDays).toBeGreaterThan(5);
    expect(r.leavePayableDays).toBeLessThan(5.5);
  });

  it("caps the payable days at the policy maximum", () => {
    const r = run({}, { leaveEncashmentMaxDays: 5 });
    expect(r.leavePayableDays).toBe(5);
    expect(line(r, "LEAVE_ENCASHMENT")!.amount).toBe(50_000);
  });

  it("is skipped for an exit type the policy excludes, and when switched off", () => {
    expect(run({ exitType: "ABSCONDMENT" }).lines.some((l) => l.code === "LEAVE_ENCASHMENT")).toBe(false);
    expect(run({}, { leaveEncashmentEnabled: false }).lines).toHaveLength(0);
  });

  it("can be based on basic pay instead of gross", () => {
    const r = run({}, { leaveEncashmentBasis: "BASIC", leaveEncashmentMaxDays: 5 });
    expect(line(r, "LEAVE_ENCASHMENT")!.amount).toBe(25_000); // 5 × 150,000 / 30
  });
});

describe("notice", () => {
  const short = { noticeDate: d("2026-09-01"), lastWorkingDate: d("2026-09-10") }; // 9 of 30 days served

  it("recovers the shortfall when the employee leaves short of notice", () => {
    const r = run(short, { leaveEncashmentEnabled: false });
    expect(r.noticeServedDays).toBe(9);
    expect(r.noticeShortfallDays).toBe(21);
    const l = line(r, "NOTICE_RECOVERY")!;
    expect(l.kind).toBe("DEDUCTION");
    expect(l.amount).toBe(210_000);
    expect(l.taxable).toBe(false);
  });

  it("pays in lieu when the employer ends employment short of notice", () => {
    const r = run({ ...short, exitType: "TERMINATION" }, { leaveEncashmentEnabled: false });
    const l = line(r, "NOTICE_PAY")!;
    expect(l.kind).toBe("EARNING");
    expect(l.amount).toBe(210_000);
  });

  it("owes no pay in lieu on a summary dismissal", () => {
    const r = run({ ...short, exitType: "TERMINATION", summaryDismissal: true }, { leaveEncashmentEnabled: false });
    expect(r.lines).toHaveLength(0);
    expect(r.notes.join(" ")).toMatch(/Summary dismissal/);
  });

  it("charges nothing when full notice was served, or for a contract end", () => {
    expect(line(run({ leaveEncashmentEnabled: false } as never), "NOTICE_RECOVERY")).toBeUndefined();
    expect(run({ ...short, exitType: "END_OF_CONTRACT" }, { leaveEncashmentEnabled: false }).lines).toHaveLength(0);
  });

  it("respects the recovery and pay-in-lieu switches", () => {
    expect(run(short, { noticeRecoveryEnabled: false, leaveEncashmentEnabled: false }).lines).toHaveLength(0);
    expect(
      run({ ...short, exitType: "TERMINATION" }, { noticePayEnabled: false, leaveEncashmentEnabled: false }).lines,
    ).toHaveLength(0);
  });
});

describe("gratuity", () => {
  const on = { gratuityEnabled: true, leaveEncashmentEnabled: false };
  const sixYears = { employmentDate: d("2020-07-01"), lastWorkingDate: d("2026-06-30") };

  it("pays days-per-year of the chosen basis for each completed year", () => {
    const l = line(run(sixYears, on), "GRATUITY")!;
    expect(l.quantity).toBe(6);
    expect(l.amount).toBe(450_000); // 6 × 15 × (150,000 basic ÷ 30)
  });

  it("is off by default and when the service minimum isn't met", () => {
    expect(line(run(sixYears, { leaveEncashmentEnabled: false }), "GRATUITY")).toBeUndefined();
    expect(line(run({}, on), "GRATUITY")).toBeUndefined();
  });

  it("can count a part-year proportionally", () => {
    const whole = line(run(sixYears, on), "GRATUITY")!.amount;
    const partial = line(
      run({ employmentDate: d("2020-01-01"), lastWorkingDate: d("2026-06-30") }, { ...on, gratuityPartialYears: true }),
      "GRATUITY",
    )!.amount;
    expect(partial).toBeGreaterThan(whole);
  });

  it("isn't paid for an excluded exit type, or after a summary dismissal", () => {
    expect(line(run({ ...sixYears, exitType: "TERMINATION" }, on), "GRATUITY")).toBeUndefined();
    expect(
      line(
        run({ ...sixYears, exitType: "TERMINATION", summaryDismissal: true }, { ...on, gratuityExitTypes: ["TERMINATION"] }),
        "GRATUITY",
      ),
    ).toBeUndefined();
  });
});

describe("severance", () => {
  const redundancy = {
    exitType: "TERMINATION",
    reasonCategory: "REDUNDANCY",
    employmentDate: d("2022-07-01"),
    lastWorkingDate: d("2026-06-30"),
    noticeDate: d("2026-05-31"),
  };

  it("pays days-per-completed-year of gross pay on a redundancy", () => {
    const l = line(run(redundancy, { severanceEnabled: true, leaveEncashmentEnabled: false }), "SEVERANCE")!;
    expect(l.quantity).toBe(4);
    expect(l.amount).toBe(600_000); // 4 × 15 × (300,000 ÷ 30)
  });

  it("only applies to a redundancy termination", () => {
    const pol = { severanceEnabled: true, leaveEncashmentEnabled: false };
    expect(line(run({ ...redundancy, reasonCategory: "PERFORMANCE" }, pol), "SEVERANCE")).toBeUndefined();
    expect(line(run(redundancy, { leaveEncashmentEnabled: false }), "SEVERANCE")).toBeUndefined();
  });
});

describe("settlementTotals", () => {
  it("nets earnings against deductions", () => {
    expect(
      settlementTotals([
        { kind: "EARNING", amount: 100_000.5 },
        { kind: "EARNING", amount: 20_000 },
        { kind: "DEDUCTION", amount: 30_000.25 },
      ]),
    ).toEqual({ grossEarnings: 120_000.5, totalDeductions: 30_000.25, netSettlement: 90_000.25 });
  });
});
