import { describe, expect, it } from "vitest";
import { ACCESS_KINDS, ACCESS_KIND_LABELS, RECORD_KINDS, UNUSUAL_RECORDS_PER_DAY, isRecordKind, summariseAccess, type AccessRow } from "@/lib/sensitive-access";

// Governance step 2a (docs/plans/hr-governance-step2-plan.md): the read log now also covers welfare, confidential and disciplinary cases, succession and improvement plans. A read
// of one of these is logged by the record's own reference, never by the employee's name, so the log cannot reveal that a named person has a welfare case.

const at = (day: string, h = 9) => new Date(`${day}T${String(h).padStart(2, "0")}:00:00Z`);
const row = (over: Partial<AccessRow> = {}): AccessRow => ({ userId: "u1", userName: "Ngozi", employeeId: null, kind: "WELFARE_CASE", at: at("2026-11-12"), ref: "case-1", ...over });

describe("the new kinds", () => {
  it("are the five records the founder named, each with a plain label, and are told apart from the payroll kinds", () => {
    expect([...RECORD_KINDS]).toEqual(["WELFARE_CASE", "CONFIDENTIAL_CASE", "DISCIPLINARY_CASE", "SUCCESSION", "IMPROVEMENT_PLAN"]);
    for (const k of RECORD_KINDS) {
      expect(ACCESS_KINDS).toContain(k);
      expect(ACCESS_KIND_LABELS[k].length).toBeGreaterThan(5);
      expect(isRecordKind(k)).toBe(true);
    }
    for (const k of ["IDENTIFIERS", "BANK", "PAYSLIP", "REPORT"]) expect(isRecordKind(k)).toBe(false);
  });
  it("never mention a person in their label", () => {
    for (const k of RECORD_KINDS) expect(ACCESS_KIND_LABELS[k]).not.toMatch(/employee'?s? (name|details)/i);
  });
});

describe("counting what a person opened", () => {
  it("counts distinct records, once each however many times they were opened, apart from employees and lists", () => {
    const rows = [row({ ref: "a" }), row({ ref: "a", at: at("2026-11-12", 11) }), row({ ref: "b" }), row({ kind: "SUCCESSION", ref: "succession-list", list: true }), row({ kind: "BANK", employeeId: "e1", ref: null })];
    const [s] = summariseAccess(rows);
    expect(s).toMatchObject({ records: 2, employees: 1, lists: 1 });
  });
  it("leaves the payroll counts exactly as they were when there are no record reads", () => {
    const [s] = summariseAccess([row({ kind: "IDENTIFIERS", employeeId: "e1", ref: null }), row({ kind: "BANK", ref: null, list: true })]);
    expect(s).toMatchObject({ records: 0, employees: 1, lists: 1, unusualDays: [] });
  });
});

describe("worth a second look", () => {
  it("flags a day on which someone opened an unusual number of different records", () => {
    expect(UNUSUAL_RECORDS_PER_DAY).toBe(10);
    const nine = Array.from({ length: 9 }, (_, i) => row({ ref: `c${i}` }));
    expect(summariseAccess(nine)[0].unusualDays).toEqual([]);
    const ten = Array.from({ length: 10 }, (_, i) => row({ ref: `c${i}` }));
    expect(summariseAccess(ten)[0].unusualDays).toEqual(["2026-11-12"]);
  });
  it("does not add reads of the same record up into a flag", () => {
    const same = Array.from({ length: 30 }, (_, i) => row({ ref: "one-case", at: at("2026-11-12", 8 + (i % 10)) }));
    expect(summariseAccess(same)[0].unusualDays).toEqual([]);
  });
});

describe("outsourced readers", () => {
  it("are marked, and listed first so they are not lost among the busiest", () => {
    const rows = [
      ...Array.from({ length: 5 }, (_, i) => row({ userId: "busy", userName: "Busy Staff", ref: `b${i}` })),
      row({ userId: "ext", userName: "Outsourced Officer", ref: "x1", external: true }),
    ];
    const out = summariseAccess(rows);
    expect(out.map((s) => s.userName)).toEqual(["Outsourced Officer", "Busy Staff"]);
    expect(out[0].external).toBe(true);
    expect(out[1].external).toBe(false);
  });
});
