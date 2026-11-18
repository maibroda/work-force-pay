import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addDays, iso } from "@/lib/dates";
import type { Ctx } from "@/lib/auth/context";
import { createEmployee } from "@/server/services/employees";
import { decideProbation, renewContract } from "@/server/services/contracts";
import { getHrPolicy, todayUtc, updateHrPolicy } from "@/server/services/hr-policy";
import { designateDecider } from "@/server/services/probation-workflow";
import { compileEmployeeData } from "@/server/services/data-requests";
import { anonymizeEmployee } from "@/server/services/employee-retention";
import {
  communicateReconsideration,
  decideReconsideration,
  myReconsiderations,
  reconsiderationCandidates,
  reconsiderationsForContract,
  requestReconsideration,
  respondToReconsideration,
  reviewReconsideration,
  withdrawReconsideration,
} from "@/server/services/probation-reconsideration";
import { extensionEnd } from "@/lib/probation-reconsideration";
import { isolatedOrg, uid } from "../helpers";

// Failed-probation reconsideration (the founder's approval of 2026-11-17, F1 to F4 as recommended; docs/plans/failed-probation-renewal-proposal.md). A failed probation stays recorded as failed; a
// reconsideration is a separately approved step that may extend it with conditions, never automatically: the supervisor asks (justification and measurable expectations), a different HR person
// reviews, an independent designated authority decides, and the extension takes effect only once the employee has been formally told. It touches no pay and no employee status.

const BAD = "Targets were missed in three of the last four weeks.";
const JUSTIFICATION = "JUSTIF-SECRET The employee improved after the warning and the site supervisor will mentor them every week.";
const day = (n: number) => iso(addDays(todayUtc(), n));
const expectation = (over: Record<string, unknown> = {}) => ({ measure: "Rota gaps per month", target: "No more than one", reviewOn: day(30), ...over });
const request = (over: Record<string, unknown> = {}) => ({ justification: JUSTIFICATION, months: 3, expectations: [expectation()], ...over });

async function user(t: Awaited<ReturnType<typeof isolatedOrg>>, role: Ctx["role"], employeeId: string | null = null) {
  return db.user.create({ data: { organizationId: t.org.id, email: `${role.toLowerCase()}-${uid()}${uid()}@rc.test`.toLowerCase(), name: `${role} ${uid()}`, role, passwordHash: "x", employeeId } });
}
const ctxOf = (u: { id: string; organizationId: string; role: string; name: string; email: string; employeeId: string | null }): Ctx => ({ userId: u.id, orgId: u.organizationId, role: u.role as Ctx["role"], name: u.name, email: u.email, employeeId: u.employeeId });

async function world(opts: { on?: boolean } = {}) {
  const t = await isolatedOrg();
  await getHrPolicy(t.org.id);
  await db.hrPolicy.update({ where: { organizationId: t.org.id }, data: { reconsiderationEnabled: opts.on ?? true, maxProbationMonths: 6 } });
  const hr1 = ctxOf(await user(t, "HR_ADMIN"));
  const hr2 = ctxOf(await user(t, "HR_ADMIN"));
  const boss = ctxOf(await user(t, "COMPANY_ADMIN"));
  const boss2 = ctxOf(await user(t, "COMPANY_ADMIN"));
  const mk = (firstName: string, extra: Record<string, unknown> = {}) => createEmployee(hr1, { firstName, lastName: "Probee", employmentDate: day(-80), categoryId: t.guardId, ...extra } as never);
  const mgrEmp = await mk("Manager", { categoryId: t.officeId });
  const emp = await mk("Employee", { reportingManagerId: mgrEmp.id, departmentId: t.deptId });
  const loner = await mk("Loner", { departmentId: t.deptId }); // no reporting manager
  const mgr = ctxOf(await user(t, "SUPERVISOR", mgrEmp.id));
  const otherMgr = ctxOf(await user(t, "SUPERVISOR", (await mk("Other manager")).id));
  const empCtx = ctxOf(await user(t, "EMPLOYEE", emp.id));
  const fin = ctxOf(await user(t, "FINANCE"));
  const aud = ctxOf(await user(t, "AUDITOR"));
  /** A probation that has run its course and been decided as FAILED today (the contract stays active, the employee stays on the payroll). */
  const failed = async (e: { id: string }) => {
    const c = await db.employmentContract.create({
      data: { organizationId: t.org.id, contractNumber: `C-${uid()}${uid()}`, employeeId: e.id, type: "PROBATION", jobTitle: "Guard", startDate: new Date(`${day(-90)}T00:00:00Z`), probationMonths: 3, probationEndDate: addDays(todayUtc(), -2), probationOutcome: "PENDING", createdBy: "test" },
    });
    await decideProbation(boss, c.id, { decision: "FAILED", note: BAD });
    return c;
  };
  const contract = await failed(emp);
  const lonerContract = await failed(loner);
  const ask = (c: Ctx = mgr, contractId = contract.id, over: Record<string, unknown> = {}) => requestReconsideration(c, contractId, request(over) as never);
  const forwarded = async (over: Record<string, unknown> = {}) => {
    const r = await ask(mgr, contract.id, over);
    await reviewReconsideration(hr1, r.id, { outcome: "FORWARD", note: "Complete and reasonable." });
    return r;
  };
  const approved = async (over: Record<string, unknown> = {}) => {
    const r = await forwarded(over);
    await decideReconsideration(boss, r.id, { decision: "APPROVE", note: "Approved on the evidence." });
    return r;
  };
  const effective = async (over: Record<string, unknown> = {}) => {
    const r = await approved(over);
    await communicateReconsideration(hr2, r.id);
    return r;
  };
  const row = (id: string) => db.probationReconsideration.findUniqueOrThrow({ where: { id }, include: { expectations: true } });
  const contractNow = (id = contract.id) => db.employmentContract.findUniqueOrThrow({ where: { id } });
  return { t, hr1, hr2, boss, boss2, mgr, otherMgr, empCtx, fin, aud, emp, loner, mgrEmp, contract, lonerContract, mk, user, failed, ask, forwarded, approved, effective, row, contractNow };
}

describe("the switch and the settings", () => {
  it("is off by default: nothing can be asked, and the settings start at the proposed defaults", async () => {
    const t = await isolatedOrg();
    const p = await getHrPolicy(t.org.id);
    expect(p).toMatchObject({ reconsiderationEnabled: false, reconsiderationWindowDays: 14, probationCeilingMonths: 9, reconsiderationMax: 1, reconsiderationMinJustification: 50, reconsiderationMinExpectations: 1 });
    const w = await world({ on: false });
    await expect(w.ask()).rejects.toThrow(/not switched on/i);
  });

  it("the settings are whole numbers within sensible limits", async () => {
    const w = await world();
    for (const bad of [{ reconsiderationWindowDays: 0 }, { reconsiderationWindowDays: 91 }, { probationCeilingMonths: 0 }, { probationCeilingMonths: 37 }, { reconsiderationMax: 0 }, { reconsiderationMax: 4 }, { reconsiderationMinJustification: 5 }, { reconsiderationMinExpectations: 0 }, { reconsiderationWindowDays: 2.5 }])
      await expect(updateHrPolicy(w.boss, bad as never), JSON.stringify(bad)).rejects.toThrow();
    await updateHrPolicy(w.boss, { reconsiderationWindowDays: 30, probationCeilingMonths: 12 });
    expect(await getHrPolicy(w.t.org.id)).toMatchObject({ reconsiderationWindowDays: 30, probationCeilingMonths: 12 });
  });
});

describe("asking for a reconsideration (F1)", () => {
  it("the reporting manager asks: it waits for HR; the failed decision and the contract are exactly as they were", async () => {
    const w = await world();
    const before = await w.contractNow();
    const r = await w.ask();
    expect(await w.row(r.id)).toMatchObject({ status: "REQUESTED", proposedMonths: 3, justification: JUSTIFICATION, requestedByUserId: w.mgr.userId, recordedByHr: false });
    expect((await w.row(r.id)).expectations).toHaveLength(1);
    const after = await w.contractNow();
    expect(after.probationOutcome).toBe("FAILED");
    expect(after.probationEndDate).toEqual(before.probationEndDate);
    expect(after.probationMonths).toBe(before.probationMonths);
    expect(await db.probationDecision.count({ where: { contractId: w.contract.id } })).toBe(1);
  });

  it("only the employee's reporting manager (or HR, when there is no reporting manager): not another manager, HR for an employee who has a manager, the employee, finance or the auditor", async () => {
    const w = await world();
    for (const c of [w.otherMgr, w.hr1, w.empCtx, w.fin, w.aud]) await expect(w.ask(c), c.role).rejects.toThrow();
    const r = await w.ask(w.hr1, w.lonerContract.id);
    expect(await w.row(r.id)).toMatchObject({ recordedByHr: true, requestedByUserId: w.hr1.userId });
    expect(await db.probationReconsideration.count({ where: { organizationId: w.t.org.id } })).toBe(1);
  });

  it("is for a probation recorded as failed on an active contract, not one still pending or confirmed", async () => {
    const w = await world();
    await db.employmentContract.update({ where: { id: w.contract.id }, data: { probationOutcome: "PENDING" } });
    await expect(w.ask()).rejects.toThrow(/failed/i);
    await db.employmentContract.update({ where: { id: w.contract.id }, data: { probationOutcome: "CONFIRMED" } });
    await expect(w.ask()).rejects.toThrow(/failed/i);
  });

  it("only within the company's window after the failed decision, counted in days", async () => {
    const w = await world();
    await db.probationDecision.updateMany({ where: { contractId: w.contract.id, decision: "FAILED" }, data: { decidedAt: new Date(Date.now() - 14 * 86_400_000) } });
    await expect(w.ask()).resolves.toBeTruthy();
    const w2 = await world();
    await db.probationDecision.updateMany({ where: { contractId: w2.contract.id, decision: "FAILED" }, data: { decidedAt: new Date(Date.now() - 16 * 86_400_000) } });
    await expect(w2.ask(w2.mgr, w2.contract.id)).rejects.toThrow(/window|days/i);
  });

  it("needs a real justification, measurable expectations each with a measure, a target and a review date, and an extension within the company's ceiling", async () => {
    const w = await world();
    await expect(w.ask(w.mgr, w.contract.id, { justification: "Too short" })).rejects.toThrow(/at least 50/);
    await expect(w.ask(w.mgr, w.contract.id, { expectations: [] })).rejects.toThrow(/expectation/i);
    await expect(w.ask(w.mgr, w.contract.id, { expectations: [expectation({ target: "" })] })).rejects.toThrow(/target/i);
    await expect(w.ask(w.mgr, w.contract.id, { expectations: [expectation({ reviewOn: day(-1) })] })).rejects.toThrow(/past/i);
    await expect(w.ask(w.mgr, w.contract.id, { months: 0 })).rejects.toThrow(/at least one month/i);
    await expect(w.ask(w.mgr, w.contract.id, { months: 7 })).rejects.toThrow(/ceiling/i); // 3 months already plus 7 is over 9
    await expect(w.ask(w.mgr, w.contract.id, { months: 6 })).resolves.toBeTruthy(); // 3 plus 6 is exactly 9
  });

  it("follows the company's own settings (a stricter justification, more expectations, a shorter window)", async () => {
    const w = await world();
    await updateHrPolicy(w.boss, { reconsiderationMinJustification: 200, reconsiderationMinExpectations: 2 });
    await expect(w.ask()).rejects.toThrow(/at least 200/);
    await expect(w.ask(w.mgr, w.contract.id, { justification: "x".repeat(200) })).rejects.toThrow(/at least 2/);
    await expect(w.ask(w.mgr, w.contract.id, { justification: "x".repeat(200), expectations: [expectation(), expectation({ measure: "Late arrivals" })] })).resolves.toBeTruthy();
  });

  it("one at a time, and no more than the limit per contract: a declined one counts, one sent back or withdrawn does not", async () => {
    const w = await world();
    const first = await w.ask();
    await expect(w.ask()).rejects.toThrow(/already/i);
    await reviewReconsideration(w.hr1, first.id, { outcome: "RETURN", note: "Add what is measured." });
    const second = await w.ask(); // a returned one does not count
    await withdrawReconsideration(w.mgr, second.id, "I will ask again later");
    const third = await w.ask(); // nor does a withdrawn one
    await reviewReconsideration(w.hr1, third.id, { outcome: "DECLINE", note: "Not supported by the record." });
    await expect(w.ask()).rejects.toThrow(/limit|already been/i); // a declined one is the one reconsideration
  });

  it("is refused once an exit has been started for the employee", async () => {
    const w = await world();
    await db.exitRecord.create({ data: { organizationId: w.t.org.id, employeeId: w.emp.id, exitType: "TERMINATION", noticeDate: new Date(), lastWorkingDate: addDays(todayUtc(), 30), reason: "Probation not confirmed", initiatedBy: "HR", status: "PENDING" } });
    await expect(w.ask()).rejects.toThrow(/exit/i);
  });

  it("belongs to the company: another company's people find nothing", async () => {
    const w = await world();
    const o = await isolatedOrg();
    await getHrPolicy(o.org.id);
    await db.hrPolicy.update({ where: { organizationId: o.org.id }, data: { reconsiderationEnabled: true } });
    await expect(requestReconsideration(o.ctx("HR_ADMIN"), w.contract.id, request() as never)).rejects.toThrow(/not found/i);
  });
});

describe("HR's review", () => {
  it("a different HR person forwards, returns or declines it, with a reason; not the supervisor, finance or the auditor", async () => {
    const w = await world();
    const r = await w.ask();
    for (const c of [w.mgr, w.fin, w.aud, w.empCtx]) await expect(reviewReconsideration(c, r.id, { outcome: "FORWARD", note: "Looks fine to me" }), c.role).rejects.toThrow();
    await expect(reviewReconsideration(w.hr1, r.id, { outcome: "FORWARD", note: "ok" })).rejects.toThrow(/reason/i);
    const u = await reviewReconsideration(w.hr1, r.id, { outcome: "FORWARD", note: "Complete and reasonable." });
    expect(u).toMatchObject({ status: "FORWARDED", hrByUserId: w.hr1.userId });
    await expect(reviewReconsideration(w.hr2, r.id, { outcome: "FORWARD", note: "A second review" })).rejects.toThrow(/already|past/i);
  });

  it("when HR recorded the request (no reporting manager), the HR person who recorded it does not also review it", async () => {
    const w = await world();
    const r = await w.ask(w.hr1, w.lonerContract.id);
    await expect(reviewReconsideration(w.hr1, r.id, { outcome: "FORWARD", note: "My own request" })).rejects.toThrow(/recorded|different/i);
    await expect(reviewReconsideration(w.hr2, r.id, { outcome: "FORWARD", note: "Complete and reasonable." })).resolves.toMatchObject({ status: "FORWARDED" });
  });

  it("declining or returning changes nothing about the probation", async () => {
    const w = await world();
    const r = await w.ask();
    await reviewReconsideration(w.hr1, r.id, { outcome: "DECLINE", note: "Not supported by the record." });
    expect((await w.row(r.id)).status).toBe("DECLINED");
    expect((await w.contractNow()).probationOutcome).toBe("FAILED");
  });
});

describe("the decision (F3)", () => {
  it("only a designated decider: the Company Administrator, or someone designated; not HR, the supervisor or the employee", async () => {
    const w = await world();
    const r = await w.forwarded();
    for (const c of [w.hr2, w.mgr, w.empCtx, w.fin, w.aud]) await expect(decideReconsideration(c, r.id, { decision: "APPROVE", note: "Approved." }), c.role).rejects.toThrow();
    const head = ctxOf(await w.user(w.t, "OPERATIONS"));
    await expect(decideReconsideration(head, r.id, { decision: "APPROVE", note: "Approved." })).rejects.toThrow(/designated/i);
    await designateDecider(w.boss, { userId: head.userId, departmentId: w.t.deptId, reason: "Head of operations" } as never);
    expect(await decideReconsideration(head, r.id, { decision: "APPROVE", note: "Approved by the head of department." })).toMatchObject({ status: "APPROVED", decidedByUserId: head.userId });
  });

  it("never the person who asked or the HR reviewer, even if designated; the one who confirmed the failure may decide", async () => {
    const w = await world();
    await designateDecider(w.boss, { userId: w.hr1.userId, reason: "Designated for the test" } as never);
    await designateDecider(w.boss, { userId: w.hr2.userId, reason: "Designated for the test" } as never);
    const r = await w.ask(w.hr1, w.lonerContract.id); // HR recorded it (the loner has no manager)
    await reviewReconsideration(w.hr2, r.id, { outcome: "FORWARD", note: "Complete and reasonable." });
    await expect(decideReconsideration(w.hr1, r.id, { decision: "APPROVE", note: "Approved." })).rejects.toThrow(/asked|different|someone else/i);
    await expect(decideReconsideration(w.hr2, r.id, { decision: "APPROVE", note: "Approved." })).rejects.toThrow(/reviewed|someone else/i);
    // the Company Administrator who recorded the failed decision is not barred
    expect(await decideReconsideration(w.boss, r.id, { decision: "APPROVE", note: "Approved by the same authority that confirmed the failure." })).toMatchObject({ status: "APPROVED" });
  });

  it("may approve a different period, within the ceiling, with a reason; declining needs a reason", async () => {
    const w = await world();
    const r = await w.forwarded({ months: 3 });
    await expect(decideReconsideration(w.boss, r.id, { decision: "APPROVE", months: 2 })).rejects.toThrow(/reason/i); // a different period needs one
    await expect(decideReconsideration(w.boss, r.id, { decision: "APPROVE", months: 7, note: "A longer period" })).rejects.toThrow(/ceiling/i);
    await expect(decideReconsideration(w.boss, r.id, { decision: "DECLINE", note: "no" })).rejects.toThrow(/reason/i);
    const u = await decideReconsideration(w.boss, r.id, { decision: "APPROVE", months: 2, note: "Two months is enough." });
    expect(u).toMatchObject({ status: "APPROVED", approvedMonths: 2 });
  });

  it("a declined reconsideration leaves the failed probation standing", async () => {
    const w = await world();
    const r = await w.forwarded();
    await decideReconsideration(w.boss, r.id, { decision: "DECLINE", note: "The record does not support it." });
    expect((await w.row(r.id)).status).toBe("DECLINED");
    expect((await w.contractNow()).probationOutcome).toBe("FAILED");
  });
});

describe("taking effect, and what it does not touch (F4)", () => {
  it("until the employee has been formally told, nothing has changed and the employee sees nothing: not when asked, reviewed or approved", async () => {
    const w = await world();
    const before = await w.contractNow();
    const r = await w.approved();
    const mid = await w.contractNow();
    expect(mid.probationOutcome).toBe("FAILED");
    expect(mid.probationEndDate).toEqual(before.probationEndDate);
    expect(await myReconsiderations(w.empCtx)).toEqual([]);
    expect((await w.row(r.id)).status).toBe("APPROVED");
  });

  it("once HR records that they were told, the probation is extended from that day, the failed decision is untouched, and the employee's status and the contract's status do not change", async () => {
    const w = await world();
    const r = await w.approved({ months: 3 });
    const failedBefore = await db.probationDecision.findFirstOrThrow({ where: { contractId: w.contract.id, decision: "FAILED" } });
    await communicateReconsideration(w.hr2, r.id);
    const c = await w.contractNow();
    expect(c).toMatchObject({ probationOutcome: "EXTENDED", probationMonths: 6, probationExtensions: 1, status: "ACTIVE" });
    expect(iso(c.probationEndDate!)).toBe(extensionEnd(iso(todayUtc()), 3));
    const history = await db.probationDecision.findMany({ where: { contractId: w.contract.id }, orderBy: { decidedAt: "asc" } });
    expect(history.map((h) => h.decision)).toEqual(["FAILED", "EXTENDED"]);
    expect(await db.probationDecision.findUniqueOrThrow({ where: { id: failedBefore.id } })).toEqual(failedBefore);
    expect(history[1]).toMatchObject({ extensionMonths: 3, decidedByUserId: w.boss.userId });
    expect(history[1].informedAt).not.toBeNull();
    expect((await db.employee.findUniqueOrThrow({ where: { id: w.emp.id } })).status).toBe("ACTIVE");
    const done = await w.row(r.id);
    expect(done).toMatchObject({ status: "EFFECTIVE", communicatedByUserId: w.hr2.userId, extensionDecisionId: history[1].id });
    expect(iso(done.newEndDate!)).toBe(iso(c.probationEndDate!));
  });

  it("the employee then sees the statement (facts only: the decision, the extension, the new review date, the conditions) and nothing the supervisor or HR wrote", async () => {
    const w = await world();
    const r = await w.effective({ months: 3 });
    const mine = await myReconsiderations(w.empCtx);
    expect(mine).toHaveLength(1);
    expect(mine[0].statement).toMatch(/extended by 3 months/);
    expect(mine[0].statement).toContain("Rota gaps per month");
    expect(mine[0].expectations).toEqual([{ measure: "Rota gaps per month", target: "No more than one", reviewOn: expect.any(Date) }]);
    const text = JSON.stringify(mine);
    for (const s of ["JUSTIF-SECRET", "Complete and reasonable", "Approved on the evidence", w.mgr.userId, w.hr1.userId, w.boss.userId]) expect(text, s).not.toContain(s);
    expect(await myReconsiderations(w.mgr)).toEqual([]); // not the supervisor's own page
    expect(r.id).toBeTruthy();
  });

  it("only HR records it, only once it is approved, and it re-checks that the probation is still failed and no exit has started", async () => {
    const w = await world();
    const r = await w.forwarded();
    await expect(communicateReconsideration(w.hr2, r.id)).rejects.toThrow(/approved/i);
    await decideReconsideration(w.boss, r.id, { decision: "APPROVE", note: "Approved on the evidence." });
    for (const c of [w.mgr, w.fin, w.aud, w.empCtx]) await expect(communicateReconsideration(c, r.id), c.role).rejects.toThrow();
    await db.exitRecord.create({ data: { organizationId: w.t.org.id, employeeId: w.emp.id, exitType: "TERMINATION", noticeDate: new Date(), lastWorkingDate: addDays(todayUtc(), 30), reason: "Probation not confirmed", initiatedBy: "HR", status: "APPROVED" } });
    await expect(communicateReconsideration(w.hr2, r.id)).rejects.toThrow(/exit/i);
    expect((await w.contractNow()).probationOutcome).toBe("FAILED");
  });

  it("nothing about pay is touched: no pay rate, no payroll record and no contract change beyond the probation", async () => {
    const w = await world();
    const rates = await db.employeePayRate.count({ where: { employeeId: w.emp.id } });
    await w.effective();
    expect(await db.employeePayRate.count({ where: { employeeId: w.emp.id } })).toBe(rates);
    expect(await db.payrollRecord.count({ where: { employeeId: w.emp.id } })).toBe(0);
  });

  it("the employee may respond once, inside the response window, and only to their own", async () => {
    const w = await world();
    const r = await w.effective();
    await expect(respondToReconsideration(w.mgr, r.id, { agree: true })).rejects.toThrow(/not found/i);
    await expect(respondToReconsideration(w.empCtx, r.id, { agree: false })).rejects.toThrow(/say why|sentence/i);
    await respondToReconsideration(w.empCtx, r.id, { agree: false, comment: "I disagree with the first target." });
    expect(await w.row(r.id)).toMatchObject({ responseAgreed: false, responseText: "I disagree with the first target." });
    await expect(respondToReconsideration(w.empCtx, r.id, { agree: true })).rejects.toThrow(/already/i);
  });

  it("the response window is counted from the day they were told", async () => {
    const w = await world();
    const r = await w.effective();
    await db.probationReconsideration.update({ where: { id: r.id }, data: { communicatedAt: new Date(Date.now() - 9 * 86_400_000) } });
    await expect(respondToReconsideration(w.empCtx, r.id, { agree: true })).rejects.toThrow(/time to respond|window/i);
  });

  it("after it takes effect the probation is decided in the usual way, and a second failure is final: no second reconsideration", async () => {
    const w = await world();
    await w.effective();
    expect((await w.contractNow()).probationOutcome).toBe("EXTENDED");
    await decideProbation(w.boss, w.contract.id, { decision: "FAILED", note: BAD });
    expect((await w.contractNow()).probationOutcome).toBe("FAILED");
    await expect(w.ask()).rejects.toThrow(/limit|already been/i);
  });
});

describe("closing the gap: a failed probation cannot be renewed as an ordinary renewal", () => {
  it("renewing a contract whose probation failed is refused, whoever asks, and the contract stays as it was", async () => {
    const w = await world();
    for (const c of [w.hr1, w.boss]) await expect(renewContract(c, w.contract.id, { endDate: day(400) }), c.role).rejects.toThrow(/failed|reconsider|exit/i);
    expect((await w.contractNow()).status).toBe("ACTIVE");
    expect(await db.employmentContract.count({ where: { employeeId: w.emp.id } })).toBe(1);
  });
});

describe("withdrawing", () => {
  it("the supervisor withdraws their own request while it waits for HR; a designated decider can withdraw until it takes effect; nobody after", async () => {
    const w = await world();
    const a = await w.ask();
    await expect(withdrawReconsideration(w.otherMgr, a.id, "Not mine to withdraw")).rejects.toThrow();
    await expect(withdrawReconsideration(w.mgr, a.id, "no")).rejects.toThrow(/reason/i);
    expect(await withdrawReconsideration(w.mgr, a.id, "The employee has resigned")).toMatchObject({ status: "WITHDRAWN" });
    const b = await w.ask();
    await reviewReconsideration(w.hr1, b.id, { outcome: "FORWARD", note: "Complete and reasonable." });
    await expect(withdrawReconsideration(w.mgr, b.id, "Changed my mind")).rejects.toThrow(); // past HR's review: the supervisor cannot
    expect(await withdrawReconsideration(w.boss, b.id, "Withdrawn by the authority")).toMatchObject({ status: "WITHDRAWN" });
  });

  it("not once it has taken effect", async () => {
    const w = await world();
    const r = await w.effective();
    await expect(withdrawReconsideration(w.boss, r.id, "Too late to take back")).rejects.toThrow(/in effect|already/i);
  });
});

describe("who reads it", () => {
  it("the supervisor who asked, HR and a designated decider read the justification and the notes; finance, the auditor, another manager and the employee do not (the employee sees only the statement, once it is in effect)", async () => {
    const w = await world();
    const r = await w.forwarded();
    for (const c of [w.mgr, w.hr1, w.boss]) expect((await reconsiderationsForContract(c, w.contract.id)).map((x) => x.id), c.role).toEqual([r.id]);
    expect((await reconsiderationsForContract(w.hr1, w.contract.id))[0]).toMatchObject({ justification: JUSTIFICATION, hrNote: "Complete and reasonable." });
    for (const c of [w.fin, w.aud, w.otherMgr, w.empCtx]) expect(await reconsiderationsForContract(c, w.contract.id), c.role).toEqual([]);
    const o = await isolatedOrg();
    expect(await reconsiderationsForContract(o.ctx("HR_ADMIN"), w.contract.id)).toEqual([]);
  });

  it("a supervisor is offered only their own direct reports whose probation failed within the window and who have no reconsideration yet", async () => {
    const w = await world();
    expect((await reconsiderationCandidates(w.mgr)).map((c) => c.contractId)).toEqual([w.contract.id]);
    expect(await reconsiderationCandidates(w.otherMgr)).toEqual([]);
    await w.ask();
    expect(await reconsiderationCandidates(w.mgr)).toEqual([]);
  });
});

describe("privacy: the audit log, erasure and the person's own copy", () => {
  it("the audit log carries ids and the step, never the justification, a note, the statement or the response", async () => {
    const w = await world();
    const r = await w.effective();
    await respondToReconsideration(w.empCtx, r.id, { agree: false, comment: "RESPONSE-SECRET I disagree with the target." });
    const rows = await db.auditLog.findMany({ where: { organizationId: w.t.org.id, entity: "ProbationReconsideration" } });
    expect(rows.map((x) => x.action).sort()).toEqual(["RECONSIDERATION_DECIDE", "RECONSIDERATION_EFFECTIVE", "RECONSIDERATION_REQUEST", "RECONSIDERATION_RESPOND", "RECONSIDERATION_REVIEW"]);
    const text = JSON.stringify(rows);
    for (const s of ["JUSTIF-SECRET", "RESPONSE-SECRET", "Complete and reasonable", "Approved on the evidence", "Rota gaps per month", "extended by"]) expect(text, s).not.toContain(s);
    expect(text).toContain(r.id);
  });

  it("erasing the employee removes the words (justification, notes, statement, response, conditions), keeps the shape and the audit log, and touches no one else's", async () => {
    const w = await world();
    const r = await w.effective();
    await respondToReconsideration(w.empCtx, r.id, { agree: false, comment: "RESPONSE-SECRET I disagree with the target." });
    const other = await w.failed(await w.mk("Other", { reportingManagerId: w.mgrEmp.id }));
    const o = await requestReconsideration(w.mgr, other.id, request({ justification: "OTHER-STAYS " + "x".repeat(60) }) as never);
    const auditBefore = await db.auditLog.count({ where: { organizationId: w.t.org.id } });
    const counts = await db.$transaction((tx) => anonymizeEmployee(tx, w.t.org.id, w.emp.id, new Date()));
    expect(counts.probationReconsiderations).toBe(1);
    const gone = await w.row(r.id);
    const text = JSON.stringify(gone);
    for (const s of ["JUSTIF-SECRET", "RESPONSE-SECRET", "Complete and reasonable", "Approved on the evidence", "Rota gaps per month", "No more than one", "extended by"]) expect(text, s).not.toContain(s);
    expect(gone).toMatchObject({ status: "EFFECTIVE", proposedMonths: 3, approvedMonths: 3 }); // the shape stays
    expect((await w.row(o.id)).justification).toContain("OTHER-STAYS");
    expect(await db.auditLog.count({ where: { organizationId: w.t.org.id } })).toBe(auditBefore);
  });

  it("the person's own data copy has the statement, the conditions and their response once it is in effect, never before and never what the supervisor or HR wrote", async () => {
    const w = await world();
    const approved = await w.approved();
    expect((await compileEmployeeData(w.t.org.id, w.emp.id)).sections.probationReconsiderations.records).toEqual([]);
    await communicateReconsideration(w.hr2, approved.id);
    await respondToReconsideration(w.empCtx, approved.id, { agree: true, comment: "I accept the conditions." });
    const text = JSON.stringify((await compileEmployeeData(w.t.org.id, w.emp.id)).sections.probationReconsiderations.records);
    for (const s of ["extended by 3 months", "Rota gaps per month", "I accept the conditions"]) expect(text, s).toContain(s);
    for (const s of ["JUSTIF-SECRET", "Complete and reasonable", "Approved on the evidence"]) expect(text, s).not.toContain(s);
  });
});
