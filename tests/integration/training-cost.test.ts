import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createEmployee } from "@/server/services/employees";
import { getHrPolicy, updateHrPolicy } from "@/server/services/hr-policy";
import { decideCost, recordCost, reverseCost, sessionCosts, setTrainingBudget, trainingSpend } from "@/server/services/training-cost";
import { isolatedOrg, uid } from "../helpers";

// Training cost and expenditure (slice 4A, approved by the founder on 2026-11-17: plan docs/plans/hr-phases-4-5-plan.md, section 6). HR records what a session cost, in exact money, and posts
// NOTHING: no journal, no payment. Spend counts APPROVED lines only. A session's cost is shared equally per attendee; nothing shows one named person's cost; over budget is a warning, never a block.

type T = Awaited<ReturnType<typeof isolatedOrg>>;

async function world() {
  const t: T = await isolatedOrg();
  const hr = t.ctx("HR_ADMIN");
  const dA = t.deptId;
  const dB = (await db.department.create({ data: { organizationId: t.org.id, code: "B", name: "Dept B" } })).id;
  const dC = (await db.department.create({ data: { organizationId: t.org.id, code: "C", name: "Dept C" } })).id;
  const mk = async (name: string, dep: string) => (await createEmployee(hr, { firstName: "Trn", lastName: name, employmentDate: "2022-01-05", categoryId: t.officeId, departmentId: dep } as never)).id;
  const staff = { a1: await mk("A1", dA), a2: await mk("A2", dA), a3: await mk("A3", dA), b1: await mk("B1", dB), b2: await mk("B2", dB), c1: await mk("C1", dC) };
  const programme = async (name: string) => db.trainingProgramme.create({ data: { organizationId: t.org.id, name, createdBy: "HR" } });
  /** A session on a date with these people marked ATTENDED, enrolled in the order given. */
  const session = async (programmeId: string, date: string, attended: string[], status: "SCHEDULED" | "COMPLETED" | "CANCELLED" = "COMPLETED") => {
    const s = await db.trainingSession.create({ data: { organizationId: t.org.id, programmeId, sessionDate: new Date(`${date}T00:00:00Z`), seats: 20, status, createdBy: "HR" } });
    for (const employeeId of attended) await db.trainingEnrolment.create({ data: { organizationId: t.org.id, sessionId: s.id, employeeId, status: "ATTENDED", enrolledBy: "HR" } });
    return s;
  };
  return { t, hr, boss: t.ctx("COMPANY_ADMIN"), fin: t.ctx("FINANCE"), aud: t.ctx("AUDITOR"), dA, dB, dC, staff, programme, session };
}
type W = Awaited<ReturnType<typeof world>>;
const line = (kind: "FEE" | "TRAVEL" | "MATERIALS" | "VENUE" | "OTHER", amount: string | number, description = "Course fee invoice") => ({ kind, amount, description });

describe("recording what a session cost", () => {
  it("is done by HR, with a kind, an amount to the kobo above zero, and a description", async () => {
    const w = await world();
    const p = await w.programme("Fire safety");
    const s = await w.session(p.id, "2026-03-10", Object.values(w.staff));
    await expect(recordCost(w.hr, s.id, line("FEE", "0"))).rejects.toThrow();
    await expect(recordCost(w.hr, s.id, line("FEE", "-5"))).rejects.toThrow();
    await expect(recordCost(w.hr, s.id, line("FEE", "10.005"))).rejects.toThrow(/kobo|decimal/i);
    await expect(recordCost(w.hr, s.id, line("FEE", "abc"))).rejects.toThrow();
    await expect(recordCost(w.hr, s.id, line("FEE", "2000000000"))).rejects.toThrow(/too large|at most/i);
    await expect(recordCost(w.hr, s.id, line("WAGES" as never, "100"))).rejects.toThrow();
    await expect(recordCost(w.hr, s.id, line("FEE", "100", "ab"))).rejects.toThrow();
    for (const ctx of [w.fin, w.aud, w.t.ctx("SUPERVISOR"), w.t.ctx("EMPLOYEE")]) await expect(recordCost(ctx, s.id, line("FEE", "100")), ctx.role).rejects.toThrow(/permission/);
    const l = await recordCost(w.hr, s.id, line("FEE", "300000.00"));
    expect(l).toMatchObject({ kind: "FEE", amount: "300000.00", status: "APPROVED" });
    for (const kind of ["TRAVEL", "MATERIALS", "VENUE", "OTHER"] as const) expect((await recordCost(w.hr, s.id, line(kind, "1.50"))).kind).toBe(kind);
  });
  it("belongs to the company: another company cannot record against it or read it", async () => {
    const w = await world();
    const p = await w.programme("Fire safety");
    const s = await w.session(p.id, "2026-03-10", [w.staff.a1]);
    const o = await isolatedOrg();
    await expect(recordCost(o.ctx("HR_ADMIN"), s.id, line("FEE", "100"))).rejects.toThrow(/not found/i);
    await expect(sessionCosts(o.ctx("HR_ADMIN"), s.id)).rejects.toThrow(/not found/i);
  });
  it("is audited by ids, the kind and the amount, never the description", async () => {
    const w = await world();
    const p = await w.programme("Fire safety");
    const s = await w.session(p.id, "2026-03-10", [w.staff.a1]);
    await recordCost(w.hr, s.id, line("FEE", "250.75", "COSTDESC-SECRET invoice from the trainer"));
    const rows = await db.auditLog.findMany({ where: { organizationId: w.t.org.id, action: "TRAINING_COST_RECORD" } });
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).toContain("250.75");
    expect(JSON.stringify(rows)).not.toContain("COSTDESC-SECRET");
  });
  it("is never blocked by a budget: over budget is a warning in the report, not a refusal", async () => {
    const w = await world();
    const p = await w.programme("Fire safety");
    const s = await w.session(p.id, "2026-03-10", Object.values(w.staff));
    await setTrainingBudget(w.hr, 2026, null, "1000.00");
    await recordCost(w.hr, s.id, line("FEE", "5000.00"));
    const r = await trainingSpend(w.hr, 2026);
    expect(r.budget).toMatchObject({ company: "1000.00", over: true });
  });
});

describe("a cost above the approval threshold", () => {
  async function withThreshold(w: W, amount: string | null) {
    await updateHrPolicy(w.boss, { trainingCostApprovalThreshold: amount } as never);
  }
  it("is a company setting, empty by default (no second person), clearable, and refused if it is not an amount", async () => {
    const w = await world();
    expect((await getHrPolicy(w.t.org.id)).trainingCostApprovalThreshold).toBeNull();
    await withThreshold(w, "100000");
    expect(String((await getHrPolicy(w.t.org.id)).trainingCostApprovalThreshold)).toBe("100000");
    await withThreshold(w, "");
    expect((await getHrPolicy(w.t.org.id)).trainingCostApprovalThreshold).toBeNull();
    await expect(withThreshold(w, "ten thousand")).rejects.toThrow();
    await expect(withThreshold(w, "-5")).rejects.toThrow();
  });
  it("waits for a second person who holds the approval right and is not the recorder; below it, nothing waits", async () => {
    const w = await world();
    const p = await w.programme("Fire safety");
    const s = await w.session(p.id, "2026-03-10", Object.values(w.staff));
    await withThreshold(w, "100000");
    const small = await recordCost(w.hr, s.id, line("FEE", "99999.99"));
    const big = await recordCost(w.hr, s.id, line("FEE", "100000.00"));
    expect(small.status).toBe("APPROVED");
    expect(big.status).toBe("PENDING");
    expect((await trainingSpend(w.hr, 2026)).total).toBe("99999.99");
    expect((await trainingSpend(w.hr, 2026)).pendingTotal).toBe("100000.00");
    await expect(decideCost(w.hr, big.id, "APPROVED", "Agreed")).rejects.toThrow(/recorded|someone else/i);
    await expect(decideCost(w.fin, big.id, "APPROVED", "Agreed")).rejects.toThrow(/permission/);
    await expect(decideCost(w.boss, big.id, "REJECTED", "no")).rejects.toThrow(/reason/i);
    await decideCost(w.boss, big.id, "APPROVED", "Agreed");
    await expect(decideCost(w.boss, big.id, "APPROVED", "Again")).rejects.toThrow(/already/i);
    expect((await trainingSpend(w.hr, 2026)).total).toBe("199999.99");
  });
  it("is not counted if it is declined", async () => {
    const w = await world();
    const p = await w.programme("Fire safety");
    const s = await w.session(p.id, "2026-03-10", Object.values(w.staff));
    await withThreshold(w, "1000");
    const big = await recordCost(w.hr, s.id, line("FEE", "5000.00"));
    await decideCost(w.boss, big.id, "REJECTED", "Not agreed with the trainer");
    const r = await trainingSpend(w.hr, 2026);
    expect(r.total).toBe("0.00");
    expect(r.pendingTotal).toBe("0.00");
  });
});

describe("correcting a cost", () => {
  it("is a new negative line that reverses the old one, once, and never an edit", async () => {
    const w = await world();
    const p = await w.programme("Fire safety");
    const s = await w.session(p.id, "2026-03-10", Object.values(w.staff));
    const l = await recordCost(w.hr, s.id, line("FEE", "5000.00"));
    await expect(reverseCost(w.hr, l.id, "no")).rejects.toThrow(/reason/i);
    for (const ctx of [w.fin, w.aud]) await expect(reverseCost(ctx, l.id, "Entered twice by mistake"), ctx.role).rejects.toThrow(/permission/);
    const rev = await reverseCost(w.hr, l.id, "Entered twice by mistake");
    expect(rev).toMatchObject({ amount: "-5000.00", status: "APPROVED" });
    await expect(reverseCost(w.hr, l.id, "Entered twice by mistake")).rejects.toThrow(/already.*reversed/i);
    await expect(reverseCost(w.hr, rev.id, "Reverse the reversal")).rejects.toThrow(/reversal/i);
    expect((await trainingSpend(w.hr, 2026)).total).toBe("0.00");
    // the original line is still there: the history is kept
    const all = await sessionCosts(w.hr, s.id);
    expect(all.lines).toHaveLength(2);
    expect(all.approvedTotal).toBe("0.00");
  });
});

describe("what HR sees of one session", () => {
  it("is every line with who recorded it, to HR alone (finance and the auditor read the totals, not the lines)", async () => {
    const w = await world();
    const p = await w.programme("Fire safety");
    const s = await w.session(p.id, "2026-03-10", Object.values(w.staff));
    await recordCost(w.hr, s.id, line("FEE", "1000.10"));
    await recordCost(w.hr, s.id, line("TRAVEL", "200.20"));
    const c = await sessionCosts(w.hr, s.id);
    expect(c.lines.map((l) => [l.kind, l.amount, l.recordedBy])).toEqual([["FEE", "1000.10", w.hr.name], ["TRAVEL", "200.20", w.hr.name]]);
    expect(c.approvedTotal).toBe("1200.30");
    for (const ctx of [w.fin, w.aud, w.t.ctx("SUPERVISOR")]) await expect(sessionCosts(ctx, s.id), ctx.role).rejects.toThrow(/permission/);
  });
});

describe("the spend report", () => {
  async function fireSafety(w: W) {
    const p = await w.programme("Fire safety");
    // six attendees in the order a1 a2 a3 b1 b2 c1: 3 in Dept A (Operations), 2 in Dept B, 1 in Dept C
    const s = await w.session(p.id, "2026-03-10", [w.staff.a1, w.staff.a2, w.staff.a3, w.staff.b1, w.staff.b2, w.staff.c1]);
    await recordCost(w.hr, s.id, line("FEE", "300000.00"));
    await recordCost(w.hr, s.id, line("MATERIALS", "12000.50"));
    return { p, s };
  }
  it("totals the approved cost of the year, only for sessions dated in that year", async () => {
    const w = await world();
    const { p } = await fireSafety(w);
    const other = await w.session(p.id, "2025-11-20", [w.staff.a1]);
    await recordCost(w.hr, other.id, line("FEE", "999.00"));
    const r = await trainingSpend(w.hr, 2026);
    expect(r.total).toBe("312000.50");
    expect((await trainingSpend(w.hr, 2025)).total).toBe("999.00");
  });
  it("shares a session's cost equally per attendee to the exact kobo, then by department: 31,200,050 kobo among six is 5,200,008 each and two kobo over, to the first two", async () => {
    const w = await world();
    await fireSafety(w);
    const r = await trainingSpend(w.hr, 2026);
    // Dept A: attendees 1, 2 and 3 take 5,200,009 + 5,200,009 + 5,200,008 = 15,600,026 kobo. Depts B (10,400,016) and C (5,200,008) have fewer than three attendances, so they are folded together.
    expect(r.byDepartment.shown).toHaveLength(1);
    expect(r.byDepartment.shown[0]).toMatchObject({ name: "Operations", total: "156000.26", attendances: 3 });
    expect(r.byDepartment.other).toMatchObject({ total: "156000.24", attendances: 3, rows: 2, shown: true });
    // nothing is lost: 156000.26 + 156000.24 = 312000.50
  });
  it("folds away a programme with fewer than three attendances, and the next smallest with it, so it cannot be found by subtraction", async () => {
    const w = await world();
    await fireSafety(w);
    const small = await w.programme("Induction");
    const tiny = await w.session(small.id, "2026-05-05", [w.staff.a1, w.staff.b1]);
    await recordCost(w.hr, tiny.id, line("FEE", "40000.00"));
    const r = await trainingSpend(w.hr, 2026);
    // Induction has two attendances, so it is folded away; because that alone would let it be found by subtraction (the total minus Fire safety), Fire safety joins it
    expect(r.byProgramme.shown).toEqual([]);
    expect(r.byProgramme.other).toMatchObject({ total: "352000.50", attendances: 8, rows: 2, shown: true });
    expect(JSON.stringify(r)).not.toContain("Induction");
  });
  it("shows a programme's average per attendee to the kobo, half up: 31,200,050 kobo over six is 5,200,008.33, shown as 52000.08", async () => {
    const w = await world();
    await fireSafety(w);
    const more = await w.programme("First aid");
    const s3 = await w.session(more.id, "2026-06-01", [w.staff.a1, w.staff.a2, w.staff.a3]);
    await recordCost(w.hr, s3.id, line("FEE", "900.00"));
    const r = await trainingSpend(w.hr, 2026);
    expect(r.byProgramme.other).toBeNull();
    expect(r.byProgramme.shown.find((x) => x.name === "Fire safety")).toMatchObject({ total: "312000.50", attendances: 6, sessions: 1, perAttendee: "52000.08" });
    expect(r.byProgramme.shown.find((x) => x.name === "First aid")).toMatchObject({ total: "900.00", attendances: 3, perAttendee: "300.00" });
  });
  it("shows the months with the same rule, so a month with one small session never stands alone", async () => {
    const w = await world();
    await fireSafety(w);
    const p2 = await w.programme("Induction");
    const tiny = await w.session(p2.id, "2026-05-05", [w.staff.a1, w.staff.b1]);
    await recordCost(w.hr, tiny.id, line("FEE", "40000.00"));
    const r = await trainingSpend(w.hr, 2026);
    expect(r.byMonth.shown).toEqual([]);
    expect(r.byMonth.other).toMatchObject({ total: "352000.50", attendances: 8, shown: true });
  });
  it("counts the cost of a cancelled session that nobody attended, under no department and in no breakdown that could name anyone", async () => {
    const w = await world();
    await fireSafety(w);
    const p2 = await w.programme("Cancelled course");
    const cancelled = await w.session(p2.id, "2026-07-01", [], "CANCELLED");
    await recordCost(w.hr, cancelled.id, line("OTHER", "5000.00", "Cancellation fee"));
    const r = await trainingSpend(w.hr, 2026);
    expect(r.total).toBe("317000.50");
  });
  it("never carries a person: no employee id, name or number anywhere in the report", async () => {
    const w = await world();
    await fireSafety(w);
    const text = JSON.stringify(await trainingSpend(w.hr, 2026));
    for (const id of Object.values(w.staff)) expect(text).not.toContain(id);
    expect(text).not.toMatch(/Trn|A1|B1|C1|employeeId/);
  });
  it("is read by HR, finance, the auditor and the administrators, and refused to managers and employees", async () => {
    const w = await world();
    await fireSafety(w);
    for (const ctx of [w.hr, w.fin, w.aud, w.boss]) expect((await trainingSpend(ctx, 2026)).total, ctx.role).toBe("312000.50");
    for (const ctx of [w.t.ctx("SUPERVISOR"), w.t.ctx("EMPLOYEE")]) await expect(trainingSpend(ctx, 2026), ctx.role).rejects.toThrow(/permission/);
  });
  it("belongs to the company", async () => {
    const w = await world();
    await fireSafety(w);
    expect((await trainingSpend((await isolatedOrg()).ctx("HR_ADMIN"), 2026)).total).toBe("0.00");
  });
});

describe("the budget", () => {
  it("is one for the company and optionally one per department, set by HR, replaced by setting again and removed by clearing", async () => {
    const w = await world();
    for (const ctx of [w.fin, w.aud, w.t.ctx("SUPERVISOR")]) await expect(setTrainingBudget(ctx, 2026, null, "100.00"), ctx.role).rejects.toThrow(/permission/);
    await expect(setTrainingBudget(w.hr, 1999, null, "100.00")).rejects.toThrow(/year/i);
    await expect(setTrainingBudget(w.hr, 2026, null, "-1")).rejects.toThrow();
    await expect(setTrainingBudget(w.hr, 2026, "not-a-department", "100.00")).rejects.toThrow(/not found/i);
    await setTrainingBudget(w.hr, 2026, null, "500000.00");
    await setTrainingBudget(w.hr, 2026, null, "600000.00");
    await setTrainingBudget(w.hr, 2026, w.dA, "200000.00");
    expect(await db.trainingBudget.count({ where: { organizationId: w.t.org.id, year: 2026 } })).toBe(2);
    expect((await trainingSpend(w.hr, 2026)).budget.company).toBe("600000.00");
    await setTrainingBudget(w.hr, 2026, null, null);
    expect((await trainingSpend(w.hr, 2026)).budget.company).toBeNull();
  });
  it("shows what is left of the company budget, and flags a department over its own", async () => {
    const w = await world();
    const p = await w.programme("Fire safety");
    const s = await w.session(p.id, "2026-03-10", [w.staff.a1, w.staff.a2, w.staff.a3]);
    await recordCost(w.hr, s.id, line("FEE", "90000.00"));
    await setTrainingBudget(w.hr, 2026, null, "500000.00");
    await setTrainingBudget(w.hr, 2026, w.dA, "50000.00");
    const r = await trainingSpend(w.hr, 2026);
    expect(r.budget).toMatchObject({ company: "500000.00", remaining: "410000.00", over: false });
    expect(r.byDepartment.shown[0]).toMatchObject({ name: "Operations", total: "90000.00", budget: "50000.00", over: true });
  });
  it("is audited by ids and the amount", async () => {
    const w = await world();
    await setTrainingBudget(w.hr, 2026, null, "500000.00");
    const rows = await db.auditLog.findMany({ where: { organizationId: w.t.org.id, action: "TRAINING_BUDGET_SET" } });
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).toContain("500000.00");
  });
});

describe("what it does not do", () => {
  it("posts nothing: recording a cost writes no journal line and no payment", async () => {
    const w = await world();
    const p = await w.programme("Fire safety");
    const s = await w.session(p.id, "2026-03-10", [w.staff.a1]);
    const before = { journals: await db.journalEntry.count({ where: { organizationId: w.t.org.id } }), invoices: await db.purchaseInvoice.count({ where: { organizationId: w.t.org.id } }) };
    await recordCost(w.hr, s.id, line("FEE", "5000.00"));
    expect({ journals: await db.journalEntry.count({ where: { organizationId: w.t.org.id } }), invoices: await db.purchaseInvoice.count({ where: { organizationId: w.t.org.id } }) }).toEqual(before);
    expect(uid()).toBeTruthy();
  });
});
