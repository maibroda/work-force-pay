import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MoneyError } from "@/lib/money-exact";
import { compensationTypeOn, holidaysApplying, resolveHourlyRate, type CompensationRow, type HourlyRateRow } from "@/lib/payroll/hourly-rates";

/**
 * Hourly pay, phase 2 (docs/plans/hourly-payroll-assessment.md): which hourly rate applies, how a person is paid on a day, and which public holidays apply at a place of work. Pure functions.
 * The founder's rules of 2026-11-19: H1, the rate comes from the employee's own rate first, then the contract and job role, then the job role, only APPROVED and in force on the day;
 * H11, the holidays that apply are those of the state of the WORK LOCATION (a holiday with no states is national). The rates are INVENTED for the tests.
 */
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
let n = 0;
const rate = (over: Partial<HourlyRateRow> & Pick<HourlyRateRow, "scope">, w = 1000): HourlyRateRow => ({
  id: `r${++n}`,
  employeeId: null,
  contractId: null,
  categoryId: null,
  weekdayRate: w,
  weekendRate: w + 500,
  holidayRate: w + 1000,
  effectiveFrom: day("2026-01-01"),
  effectiveTo: null,
  status: "APPROVED",
  ...over,
});
const EMP = { scope: "EMPLOYEE" as const, employeeId: "e1" };
const CC = { scope: "CONTRACT_CATEGORY" as const, contractId: "k1", categoryId: "guard" };
const CAT = { scope: "CATEGORY" as const, categoryId: "guard" };
const who = { employeeId: "e1", contractId: "k1", categoryId: "guard", date: day("2026-11-20") };

describe("resolveHourlyRate: the employee's own rate, then the contract and job role, then the job role (H1)", () => {
  it("the employee's own rate wins over a contract-and-role rate and a role rate", () => {
    const own = rate({ ...EMP }, 3000);
    const found = resolveHourlyRate([rate({ ...CAT }, 1000), rate({ ...CC }, 2000), own], who);
    expect(found).toMatchObject({ rateId: own.id, scope: "EMPLOYEE", rates: { weekday: 3000, weekend: 3500, holiday: 4000 } });
  });

  it("with no personal rate, the contract-and-role rate wins over the role rate", () => {
    const cc = rate({ ...CC }, 2000);
    expect(resolveHourlyRate([rate({ ...CAT }, 1000), cc], who)).toMatchObject({ rateId: cc.id, scope: "CONTRACT_CATEGORY" });
  });

  it("with neither, the role rate applies", () => {
    const cat = rate({ ...CAT }, 1000);
    expect(resolveHourlyRate([cat], who)).toMatchObject({ rateId: cat.id, scope: "CATEGORY" });
  });

  it("another person's rate, another contract's rate and another role's rate never apply", () => {
    const rows = [rate({ scope: "EMPLOYEE", employeeId: "e2" }), rate({ scope: "CONTRACT_CATEGORY", contractId: "k2", categoryId: "guard" }), rate({ scope: "CONTRACT_CATEGORY", contractId: "k1", categoryId: "clean" }), rate({ scope: "CATEGORY", categoryId: "clean" })];
    expect(resolveHourlyRate(rows, who)).toBeNull();
  });

  it("a person with no contract (back office) skips the contract-and-role level and gets their own or the role's rate", () => {
    const cat = rate({ ...CAT }, 1000);
    expect(resolveHourlyRate([rate({ ...CC }, 2000), cat], { ...who, contractId: null })).toMatchObject({ rateId: cat.id });
  });

  it("nothing applies, so the answer is null and never zero: the caller must refuse to pay without a rate", () => {
    expect(resolveHourlyRate([], who)).toBeNull();
  });
});

describe("resolveHourlyRate: only an approved rate that is in force on the day", () => {
  it("a pending, rejected or cancelled rate is never used", () => {
    for (const status of ["PENDING", "REJECTED", "CANCELLED"]) expect(resolveHourlyRate([rate({ ...EMP, status })], who), status).toBeNull();
  });

  it("the first and last day of a rate are both inside it", () => {
    const r = rate({ ...EMP, effectiveFrom: day("2026-11-01"), effectiveTo: day("2026-11-30") });
    expect(resolveHourlyRate([r], { ...who, date: day("2026-11-01") })).not.toBeNull();
    expect(resolveHourlyRate([r], { ...who, date: day("2026-11-30") })).not.toBeNull();
    expect(resolveHourlyRate([r], { ...who, date: day("2026-10-31") })).toBeNull();
    expect(resolveHourlyRate([r], { ...who, date: day("2026-12-01") })).toBeNull();
  });

  it("a rate change in the middle of a month: the old rate up to the day before, the new rate from the day it starts", () => {
    const old = rate({ ...EMP, effectiveFrom: day("2026-01-01"), effectiveTo: day("2026-11-15") }, 1000);
    const next = rate({ ...EMP, effectiveFrom: day("2026-11-16") }, 1200);
    expect(resolveHourlyRate([old, next], { ...who, date: day("2026-11-15") })?.rates.weekday).toBe(1000);
    expect(resolveHourlyRate([old, next], { ...who, date: day("2026-11-16") })?.rates.weekday).toBe(1200);
  });

  it("when the person's own rate has ended or not yet started, the next level down applies", () => {
    const ended = rate({ ...EMP, effectiveTo: day("2026-10-31") }, 3000);
    const cc = rate({ ...CC }, 2000);
    expect(resolveHourlyRate([ended, cc], who)).toMatchObject({ rateId: cc.id });
  });

  it("two approved rates in force at the same level on the same day is refused, not guessed (the service prevents it; this is the second line of defence)", () => {
    expect(() => resolveHourlyRate([rate({ ...EMP }), rate({ ...EMP })], who)).toThrow(MoneyError);
  });
});

describe("compensationTypeOn: how a person is paid on a day", () => {
  const row = (type: "MONTHLY" | "HOURLY", from: string, status = "APPROVED"): CompensationRow => ({ type, effectiveFrom: day(from), status });

  it("everyone is paid monthly until an approved record says otherwise", () => {
    expect(compensationTypeOn([], day("2026-11-20"))).toBe("MONTHLY");
    expect(compensationTypeOn([row("HOURLY", "2026-12-01", "PENDING")], day("2026-12-15"))).toBe("MONTHLY");
  });

  it("from the day an approved record starts, the person is paid that way", () => {
    const rows = [row("HOURLY", "2026-11-16")];
    expect(compensationTypeOn(rows, day("2026-11-15"))).toBe("MONTHLY");
    expect(compensationTypeOn(rows, day("2026-11-16"))).toBe("HOURLY");
    expect(compensationTypeOn(rows, day("2027-03-01"))).toBe("HOURLY");
  });

  it("the latest approved record starting on or before the day decides, so a person can go back to monthly", () => {
    const rows = [row("HOURLY", "2026-03-01"), row("MONTHLY", "2026-09-01"), row("HOURLY", "2026-12-01")];
    expect(compensationTypeOn(rows, day("2026-05-01"))).toBe("HOURLY");
    expect(compensationTypeOn(rows, day("2026-10-01"))).toBe("MONTHLY");
    expect(compensationTypeOn(rows, day("2026-12-31"))).toBe("HOURLY");
  });

  it("rejected and cancelled records never count", () => {
    expect(compensationTypeOn([row("HOURLY", "2026-01-01", "REJECTED"), row("HOURLY", "2026-01-01", "CANCELLED")], day("2026-06-01"))).toBe("MONTHLY");
  });
});

describe("holidaysApplying: the holidays that apply at a place of work (H11: the state of the work location)", () => {
  const rows = [
    { date: "2026-10-01", states: [] as string[] }, // a national holiday
    { date: "2026-11-02", states: ["Lagos"] },
    { date: "2026-11-09", states: ["Ogun", "Oyo"] },
    { date: "2026-12-25", states: [] },
  ];

  it("a national holiday (no states) applies at every place", () => {
    for (const place of ["Lagos", "Ogun", "Kano", "FCT"]) expect(holidaysApplying(rows, place).has("2026-10-01"), place).toBe(true);
  });

  it("a state holiday applies only in that state or states", () => {
    expect([...holidaysApplying(rows, "Lagos")].sort()).toEqual(["2026-10-01", "2026-11-02", "2026-12-25"]);
    expect([...holidaysApplying(rows, "Ogun")].sort()).toEqual(["2026-10-01", "2026-11-09", "2026-12-25"]);
    expect([...holidaysApplying(rows, "Kano")].sort()).toEqual(["2026-10-01", "2026-12-25"]);
  });

  it("a place with no recognised state gets the national holidays only (a state holiday is never assumed)", () => {
    expect([...holidaysApplying(rows, null)].sort()).toEqual(["2026-10-01", "2026-12-25"]);
    expect([...holidaysApplying(rows, "Narnia")].sort()).toEqual(["2026-10-01", "2026-12-25"]);
  });

  it("the state is read the way the rest of the application reads it (spelling and case)", () => {
    expect(holidaysApplying(rows, "lagos").has("2026-11-02")).toBe(true);
    expect(holidaysApplying([{ date: "2026-11-02", states: ["FCT"] }], "Abuja").has("2026-11-02")).toBe(true);
  });
});

describe("the file keeps to the exact-money rules", () => {
  it("uses no floating-point rounding or parsing", () => {
    expect(readFileSync("src/lib/payroll/hourly-rates.ts", "utf8")).not.toMatch(/toFixed|parseFloat|Math\.round/);
  });
});
