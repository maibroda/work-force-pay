import { describe, expect, it } from "vitest";
import { DEFAULT_VARIANCE_POLICY, reconcile, varianceFindings, type PayPerson } from "@/lib/payroll/variance";

const p = (id: string, net: number, gross = net * 1.2): PayPerson => ({ id, label: `EMP-${id} Name ${id}`, net, gross });
const none = new Set<string>();
const policy = DEFAULT_VARIANCE_POLICY;

describe("payroll variance findings", () => {
  it("finds nothing when there is no earlier payroll", () => {
    expect(varianceFindings({ prior: [], current: [p("1", 100000)], joiners: none, leavers: none, policy })).toEqual([]);
  });

  it("finds nothing for an unchanged payroll", () => {
    const people = [p("1", 100000), p("2", 120000)];
    expect(varianceFindings({ prior: people, current: people, joiners: none, leavers: none, policy })).toEqual([]);
  });

  it("flags a headcount move beyond the limit, but not one within it", () => {
    const prior = Array.from({ length: 20 }, (_, i) => p(String(i), 100000));
    const plus1 = [...prior, p("x", 100000)]; // +5%: at the limit, not beyond it
    expect(varianceFindings({ prior, current: plus1, joiners: new Set(["x"]), leavers: none, policy }).map((f) => f.code)).not.toContain("HEADCOUNT_CHANGE");
    const plus2 = [...plus1, p("y", 100000)];
    const f = varianceFindings({ prior, current: plus2, joiners: new Set(["x", "y"]), leavers: none, policy });
    expect(f.find((x) => x.code === "HEADCOUNT_CHANGE")?.message).toMatch(/from 20 to 22 \(\+10%\)/);
  });

  it("flags total net pay moving beyond the limit", () => {
    const prior = [p("1", 100000), p("2", 100000)];
    const current = [p("1", 100000), p("2", 125000)];
    const f = varianceFindings({ prior, current, joiners: none, leavers: none, policy });
    expect(f.map((x) => x.code)).toContain("TOTAL_NET_VARIANCE");
  });

  it("flags one person's net pay only when it moves by enough, in both percent and naira", () => {
    const prior = [p("1", 100000), p("2", 100000), p("3", 10000), p("4", 100000)];
    const current = [p("1", 119000), p("2", 130000), p("3", 14000), p("4", 100000)];
    const f = varianceFindings({ prior, current, joiners: none, leavers: none, policy: { ...policy, totalPct: 100 } });
    // 1: +19% (under 20%); 2: +30% and 30,000; 3: +40% but only 4,000 (under the 5,000 floor)
    expect(f.map((x) => x.employeeId)).toEqual(["2"]);
    expect(f[0].message).toMatch(/\+30%/);
  });

  it("does not flag a joiner or a leaver as a personal variance", () => {
    const prior = [p("1", 100000), p("2", 100000)];
    const current = [p("1", 100000), p("2", 30000)];
    const f = varianceFindings({ prior, current, joiners: none, leavers: new Set(["2"]), policy: { ...policy, totalPct: 100 } });
    expect(f.filter((x) => x.code === "EMPLOYEE_NET_VARIANCE")).toEqual([]);
  });

  it("flags a person who was paid nothing last time", () => {
    const f = varianceFindings({ prior: [p("1", 0), p("2", 100000)], current: [p("1", 80000), p("2", 100000)], joiners: none, leavers: none, policy: { ...policy, totalPct: 1000 } });
    expect(f.find((x) => x.employeeId === "1")?.message).toMatch(/was nil/);
  });
});

describe("payroll reconciliation bridge", () => {
  it("walks the previous payroll to this one and adds up", () => {
    const prior = [p("1", 100000, 120000), p("2", 100000, 120000), p("3", 50000, 60000)];
    const current = [p("1", 110000, 130000), p("2", 100000, 120000), p("4", 70000, 80000), p("5", 20000, 25000)];
    const b = reconcile({ prior, current, joiners: new Set(["4"]), leavers: new Set(["3"]) });
    expect(b.priorHeadcount).toBe(3);
    expect(b.currentHeadcount).toBe(4);
    expect(b.joiners.map((x) => x.id)).toEqual(["4"]);
    expect(b.leavers.map((x) => x.id)).toEqual(["3"]);
    expect(b.otherAdded.map((x) => x.id)).toEqual(["5"]); // not a joiner: needs a word
    expect(b.otherRemoved).toEqual([]);
    expect(b.net).toEqual({ prior: 250000, joiners: 70000, leavers: -50000, otherAdded: 20000, otherRemoved: 0, continuing: 10000, current: 300000 });
    expect(b.gross.continuing).toBe(10000);
    expect(b.balanced).toBe(true);
  });

  it("is empty and balanced when there is no earlier payroll", () => {
    const b = reconcile({ prior: [], current: [p("1", 100000)], joiners: new Set(["1"]), leavers: none });
    expect(b.hasPrior).toBe(false);
    expect(b.balanced).toBe(true);
  });

  it("does not drift on kobo amounts", () => {
    const prior = [p("1", 0.1), p("2", 0.2)];
    const current = [p("1", 0.3), p("2", 0.2)];
    const b = reconcile({ prior, current, joiners: none, leavers: none });
    expect(b.net.continuing).toBe(0.2);
    expect(b.balanced).toBe(true);
  });
});
