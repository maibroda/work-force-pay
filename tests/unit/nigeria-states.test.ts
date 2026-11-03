import { describe, expect, it } from "vitest";
import { groupPayeByState, missingStateSeverity, NIGERIA_STATES, normaliseState, STATE_NOT_RECORDED } from "@/lib/nigeria-states";

describe("the states of Nigeria", () => {
  it("are the 36 states and the Federal Capital Territory, each once", () => {
    expect(NIGERIA_STATES).toHaveLength(37);
    expect(new Set(NIGERIA_STATES).size).toBe(37);
    expect(NIGERIA_STATES).toContain("Lagos");
    expect(NIGERIA_STATES).toContain("Akwa Ibom");
    expect(NIGERIA_STATES).toContain("FCT");
  });

  it("recognises a typed state whatever its case, spacing or punctuation, and gives the proper name", () => {
    expect(normaliseState("ogun")).toBe("Ogun");
    expect(normaliseState("  LAGOS ")).toBe("Lagos");
    expect(normaliseState("akwa-ibom")).toBe("Akwa Ibom");
    expect(normaliseState("Cross  River")).toBe("Cross River");
    expect(normaliseState("Nassarawa")).toBe("Nasarawa");
  });

  it("recognises the Federal Capital Territory under its usual names", () => {
    for (const t of ["FCT", "fct", "F.C.T.", "Abuja", "abuja", "Federal Capital Territory", "FCT Abuja", "FCT-Abuja"]) expect(normaliseState(t), t).toBe("FCT");
  });

  it("refuses anything it does not recognise, and treats blank as nothing", () => {
    expect(normaliseState("Atlantis")).toBeNull();
    expect(normaliseState("Lagos State Government")).toBeNull();
    expect(normaliseState("")).toBeNull();
    expect(normaliseState(null)).toBeNull();
    expect(normaliseState(undefined)).toBeNull();
  });
});

describe("PAYE grouped by the state of residence", () => {
  const rec = (state: string | null, paye: number) => ({ payeState: state, paye });

  it("gives one line per state, in alphabetical order, with the amount and the number of people taxed", () => {
    const lines = groupPayeByState([rec("Ogun", 2000), rec("Lagos", 1000), rec("Lagos", 3000.5), rec("Ogun", 0), rec("Lagos", 0)]);
    expect(lines).toEqual([
      { state: "Lagos", paye: 4000.5, headcount: 2 },
      { state: "Ogun", paye: 2000, headcount: 1 },
    ]);
  });

  it("puts anyone with no state, or an unrecognised one, on the 'State not recorded' line, last", () => {
    const lines = groupPayeByState([rec(null, 500), rec("Lagos", 100), rec("", 250), rec("Atlantis", 25.25)]);
    expect(lines.map((l) => l.state)).toEqual(["Lagos", STATE_NOT_RECORDED]);
    expect(lines[1]).toEqual({ state: STATE_NOT_RECORDED, paye: 775.25, headcount: 3 });
  });

  it("adds up exactly to the PAYE total, with no floating-point drift", () => {
    const pieces = Array.from({ length: 300 }, (_, i) => rec(i % 3 === 0 ? "Lagos" : i % 3 === 1 ? "Ogun" : null, 0.1 + (i % 7) * 0.01));
    const lines = groupPayeByState(pieces);
    const kobo = (n: number) => Math.round(n * 100);
    expect(lines.reduce((a, l) => a + kobo(l.paye), 0)).toBe(pieces.reduce((a, p) => a + kobo(p.paye), 0));
  });

  it("gives nothing when nobody is taxed", () => {
    expect(groupPayeByState([rec("Lagos", 0), rec(null, 0)])).toEqual([]);
    expect(groupPayeByState([])).toEqual([]);
  });
});

describe("what a missing state of residence does to a payroll", () => {
  it("is a warning by default, and a blocking (critical) finding when the payroll rule requires a state", () => {
    expect(missingStateSeverity(false)).toBe("WARNING");
    expect(missingStateSeverity(true)).toBe("CRITICAL");
  });
});
